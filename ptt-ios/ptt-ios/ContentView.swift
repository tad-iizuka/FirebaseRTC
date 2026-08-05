//
//  ContentView.swift
//  ptt-ios
//
//  [LiveKit移行 + Firebase Auth対応 + 招待制ルーム対応 + Phase5テキストチャット + 送話ロック連携 + オンボーディング]
//  Web版(ptt-client/src/views)と同等のUI:
//  Googleサインイン → 招待コード参加 → PTTボタン → 送話中リスト → チャット → ログ
//  クライアントIDの手入力は廃止(token-serverは常にFirebase ID Token由来のuidを
//  identityとして使うため、クライアントが自己申告する値は元々使われていなかった)。
//  ルームIDの直接入力による接続も廃止し、token-serverのinvite_only設計
//  (POST /rooms/:roomId/join で招待コード検証)に合わせた。
//
//  [ルーム作成のadmin-dashboard移管]
//  以前はここにルーム作成ボタン(作成者への招待コード払い出し表示付き)があったが、
//  ルーム作成はadmin-dashboard専用のPOST /admin/rooms(rooms:create権限)へ
//  一本化した。ptt-iosは常に既存ルームへの参加(招待コードでのjoin)のみを行う
//  (Web版ptt-client/src/views/RoomSelectView.vueと同じ設計。brushup-plan.md参照)。
//  これに伴い、招待コードの表示(inviteBox)も廃止した。代わりにadmin-dashboardで
//  設定できるルーム名(name)を表示する。
//
//  [送話ロック連携]
//  PTTConnectionManager が token-server の /talk/start・/talk/heartbeat・/talk/stop
//  (token-server/routes/talk.js)を呼び出し、サーバー側で排他制御を強制する。
//  このView側は connection.currentTalkerUid を見て、自分以外が発話ロックを
//  保持している間はPTTボタンを無効化し、「誰が話しているか」を表示するだけに留める
//  (実際のロック取得/延長/解放ロジックはすべてPTTConnectionManagerに集約されている)。
//
//  [オンボーディング]
//  Web版(ptt-client/src/App.vue)と同じ設計判断: onboarding.hasCompletedOnboarding が
//  falseの間は、サインイン状態に関わらずスワイプ形式の紹介画面(PTTOnboardingView)を
//  最優先で表示する。完了/スキップすると通常のサインイン〜ルームフローに切り替わる。
//

import SwiftUI
import Foundation
import FirebaseAuth
import PhotosUI
import UniformTypeIdentifiers
import UIKit

/// [モバイルUI再編・2026-08-04(再改定)] Talk/Members/Chat/Settingsの4タブ構成。
/// brushup-plan.mdの「モバイル最適化タブバー構成案」に基づく。
/// サインイン後は常にこの4タブを表示し、Talkタブがルーム選択画面と通話画面を
/// 兼ねる(未入室=ルーム選択、入室中=PTTボタン+退出ボタン)。
/// 頻度の低い操作(プロフィール/サインアウト/録音操作/ニックネーム変更/接続設定)は
/// 独立のSettingsタブ(歯車アイコン)に集約する。
private enum RootTab: Hashable {
    case talk, members, chat, settings
}

struct ContentView: View {

    @StateObject private var auth = PTTAuthManager()
    @StateObject private var roomManager = PTTRoomManager()
    @StateObject private var savedRooms = PTTSavedRoomsStore()
    @StateObject private var connection = PTTConnectionManager()
    @StateObject private var chat = PTTChatStore()
    @StateObject private var ban = PTTBanStore()
    @StateObject private var recording = PTTRecordingStore()
    @StateObject private var report = PTTReportStore()
    /// [Phase13 バッジ表示UI] Web版ParticipantList.vueの移植。GET /:roomId/badges をポーリングする。
    @StateObject private var badges = PTTBadgeStore()
    @StateObject private var orgContext = PTTOrgContextStore()
    @StateObject private var onboarding = PTTOnboardingStore()
    /// [Phase9 バックグラウンド動作] ロック画面/常駐通知/ヘッドセットボタンからの
    /// 送話操作を仲介する。connectionへはattach(to:)経由でweak参照するのみ。
    @StateObject private var backgroundControl = PTTBackgroundControlManager()

    /// [2026-07-29] 接続先(tokenServerURL/livekitURL)は設定画面(歯車アイコン)へ移設した。
    /// 従来は@Stateとして保持し永続化もしていなかったが、PTTSettingsStore(UserDefaults)から
    /// 都度導出する計算プロパティに変更した(Android版PTTApp.ktの同名コメント参照)。
    @StateObject private var settingsStore = PTTSettingsStore()
    private var tokenServerURL: String { settingsStore.tokenServerURL }
    private var livekitURL: String { settingsStore.livekitURL }
    @State private var joinRoomId: String = ""
    @State private var joinInviteCode: String = ""
    @State private var chatInputText: String = ""
    /// [招待リンク/QR] ptt_iosApp.swiftのonOpenURL(Universal Link)経由で受け取った
    /// room/codeの橋渡し。deeplink-qr-join-plan.md参照。
    @ObservedObject private var pendingInviteStore = PTTPendingInviteStore.shared
    @State private var isQrScannerPresented = false

    /// [モバイルUI再編・2026-08-04] 入室後に表示中のタブ。
    @State private var selectedTab: RootTab = .talk
    /// 実際に参加してLiveKit接続に進んだルームID。nilの間はルーム選択画面を表示する。
    @State private var activeRoomId: String?
    /// [ルーム名] admin-dashboardで設定されたルーム名。未設定 or 未取得の場合はnull。
    @State private var currentRoomName: String?
    /// [BAN対応] BANボタン押下時の確認ダイアログの対象。
    @State private var banTarget: PTTParticipantInfo?
    /// [2026-08-04・次アクションitem4] バッジ付与UIで選択中のバッジ(uid -> badgeId)。
    /// Web版ParticipantList.vueのselectedBadgeId(<select>のv-model)に相当。
    @State private var selectedBadgeId: [String: String] = [:]
    /// [BAN対応] 自分がBANされてルームを追い出された直後に表示する通知文言。
    @State private var banNotice: String?
    /// [録音UI] 録音開始ボタン押下時の確認ダイアログ表示フラグ。
    /// Web版ConfirmDialog(RecordingBar.vueのshowStartConfirm)に相当。
    @State private var showRecordingStartConfirm = false
    /// [通報UI] 通報対象の参加者。Web版の`window.prompt`に代わり、
    /// テキスト入力欄付きのalertダイアログで理由を入力させる。
    @State private var reportTarget: PTTParticipantInfo?
    @State private var reportReasonText: String = ""
    /// [Phase10: Guestロール] ニックネーム編集中かどうか、および編集中のテキスト。
    @State private var isEditingNickname = false
    @State private var nicknameDraft: String = ""
    /// [モバイルUI再編・2026-08-04(再改定)] 設定タブ内「接続設定」行から開くシートの
    /// 表示フラグ。従来はヘッダーのPTTSettingsIconが自前で保持していたが、
    /// 設定タブの通常行として表示するためContentView側で保持する。
    @State private var isConnectionSettingsPresented = false

    // [Phase16: チャット添付ファイル] Web版ChatPanel.vueのpendingFileの移植。
    // 選択直後には送信せず、送信ボタンが押されるまでここに保持しておく。
    @State private var chatPendingAttachmentData: Data?
    @State private var chatPendingAttachmentFileName: String?
    @State private var chatPendingAttachmentContentType: String?
    @State private var showChatPhotoPicker = false
    @State private var showChatFileImporter = false
    @State private var chatPhotoPickerItem: PhotosPickerItem?
    /// サムネイル(画像)の表示用にダウンロード済みのUIImageをmessageIdごとにキャッシュする。
    @State private var chatThumbnailImages: [String: UIImage] = [:]

    var body: some View {
        Group {
            if !onboarding.hasCompletedOnboarding {
                // [オンボーディング] 初回起動時はサインイン前でもこの画面を最優先で表示する。
                PTTOnboardingView(onComplete: { onboarding.complete() })
            } else if auth.currentUser == nil {
                // [モバイルUI再編・2026-08-04(再改定)] 未ログイン画面は上下左右中央揃えの
                // 単一グラスカードのみで構成する(ヘッダーバーは持たない)。詳細はauthSection参照。
                authSection
            } else {
                // [モバイルUI再編・2026-08-04(再改定)] サインイン後は入室状態に関わらず
                // 常にTalk/参加者/チャット/設定の4タブを表示する。未入室中はTalkタブが
                // ルーム選択画面を、入室中はPTTボタン+退出ボタンを兼ねる(各タブ内で分岐)。
                // 接続状態・ルーム名・録音中バナーは入室中のみ、TabViewの外側
                // (全タブ共通のヘッダー領域)に固定表示する。
                // [不具合修正・2026-08-04(3訂)] 設定タブはプロフィール/接続設定/録音操作など
                // 「ルームに紐づかない・または既にタブ内(guestStatusSection等)で
                // ルーム文脈を示している」項目が中心のため、他タブと違ってこの
                // 共通ヘッダー(ルーム名・パンくず・接続状態行)を表示する意味が薄い。
                // ユーザー指摘を受け、設定タブ選択中はこのヘッダーブロックを非表示にする。
                // [不具合修正・2026-08-04(4訂)] 標準TabViewのLiquid Glass選択ハイライトは、
                // 切り替えアニメーション中に背後のコンテンツを再サンプリングするらしく、
                // `.toolbarBackground`で固定色を指定してもタップの瞬間だけ白っぽく
                // フラッシュする現象が実機録画で確認された(スクリーンショットでは
                // アニメーション完了後の状態しか捉えられず気づけなかった)。
                // 標準TabViewへの依存をやめ、コンテンツ切り替え・タブバー描画とも
                // 自前で行うことで、色を完全にこちらの管理下に置く。
                VStack(spacing: 0) {
                    if activeRoomId != nil && selectedTab != .settings {
                        header()
                        roomNameHeader
                        recordingBanner
                    }

                    Group {
                        switch selectedTab {
                        case .talk: talkTabContent
                        case .members: membersTabContent
                        case .chat: chatTabContent
                        case .settings: settingsTabContent
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                    customTabBar
                }
            }
        }
        .background(.pttBackground)
        .foregroundColor(.pttText)
        .onAppear {
            // [Phase9] 1回だけ実行すればよい(attach内部でも二重呼び出しをガードしている)。
            backgroundControl.attach(to: connection)
        }
        .onChange(of: pendingInviteStore.pendingInvite, initial: true) { _, invite in
            // [招待リンク/QR] onOpenURL(Universal Link)またはQRスキャナーが検出した
            // room/codeを入力欄へ反映するだけ(自動参加はしない)。initial: trueにより、
            // サインイン前にリンクを開いていた場合(pendingInviteが既にセット済みの状態で
            // ContentViewが初めて描画される場合)も取りこぼさない。
            guard let invite else { return }
            joinRoomId = invite.roomId
            joinInviteCode = invite.inviteCode
            pendingInviteStore.consume()
        }
        .onChange(of: auth.currentUser?.uid, initial: true) { _, newUid in
            savedRooms.load(forUid: newUid)
            // [不具合修正・2026-08-04(7訂)] 設定タブでサインアウト→再サインインすると、
            // selectedTabが.settingsのまま残っていて再ログイン後も設定タブに
            // 留まってしまう指摘を受けた。ログイン画面自体はタブを持たないため
            // 気づきにくいが、サインイン成功(newUidが非nilになった瞬間)には
            // 常にメインタブである通話タブへ戻すのが自然な挙動と判断し、
            // ここでリセットする。
            if newUid != nil {
                selectedTab = .talk
            }
        }
        // [BAN対応] 自分がBANされたことをリアルタイム検知したら、即座にルームから退出する。
        // BAN自体の強制力はLiveKit側の即時キック(サーバー)が担うため、ここは表示のための補助。
        .onChange(of: ban.isBanned) { _, isBanned in
            guard isBanned else { return }
            banNotice = String(localized: "このルームから排除されました")
            leaveRoom()
        }
        .alert(
            "BANしますか?",
            isPresented: Binding(
                get: { banTarget != nil },
                set: { if !$0 { banTarget = nil } }
            ),
            presenting: banTarget
        ) { target in
            Button("BANする", role: .destructive) { confirmBan(target) }
            Button("キャンセル", role: .cancel) { banTarget = nil }
        } message: { target in
            Text(String(format: NSLocalizedString("%@ をこのルームからBANしますか?\nこの操作は取り消せません。", comment: "Ban confirmation dialog message"), target.name))
        }
        // [録音UI] 開始ボタン押下時の確認ダイアログ。Web版RecordingBar.vueの
        // ConfirmDialog(showStartConfirm)に相当。録音中であることは全参加者に
        // 開示される旨をここで明示してから開始する。
        .alert(
            "録音を開始しますか?",
            isPresented: $showRecordingStartConfirm
        ) {
            Button("開始する") { startRecording() }
            Button("キャンセル", role: .cancel) { showRecordingStartConfirm = false }
        } message: {
            Text("録音中であることは全参加者に開示されます。")
        }
        // [通報UI] Web版の`window.prompt(t('room.reportPromptLabel', ...))`に相当。
        // 空文字のまま送信した場合は何もしない(Web版と同じ挙動)。
        .alert(
            "通報する",
            isPresented: Binding(
                get: { reportTarget != nil },
                set: { if !$0 { reportTarget = nil; reportReasonText = "" } }
            ),
            presenting: reportTarget
        ) { target in
            TextField("通報理由", text: $reportReasonText)
            Button("送信する") { submitReport(target) }
            Button("キャンセル", role: .cancel) { reportTarget = nil; reportReasonText = "" }
        } message: { target in
            Text(String(format: NSLocalizedString("%@ を通報します。理由を入力してください。", comment: "Report prompt message"), target.name))
        }
    }

    // MARK: - Tabs (4タブ構成: 通話/参加者/チャット/設定)

    /// [不具合修正・2026-08-04(4訂)] 標準TabViewのタブバーを置き換える自前実装。
    /// 色を完全に固定できるよう、選択状態のハイライトも`Color.pttAccentDim`ベースの
    /// カプセルで自前描画する(システムのLiquid Glass選択アニメーションに伴う
    /// 色のフラッシュを避けるため。詳細はbody側のコメント参照)。
    /// カプセル自体はガラス風の質感を保つよう`.glassEffect()`で仕上げる。
    private var customTabBar: some View {
        GlassEffectContainer(spacing: 8) {
            HStack(spacing: 2) {
                tabBarButton(tab: .talk, systemImage: "mic.circle", label: "通話")
                tabBarButton(tab: .members, systemImage: "person.2", label: "参加者")
                tabBarButton(tab: .chat, systemImage: "bubble.left.and.bubble.right", label: "チャット")
                tabBarButton(tab: .settings, systemImage: "gearshape", label: "設定")
            }
            .padding(6)
            .glassEffect(.regular.tint(.pttPanel), in: Capsule())
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 8)
        .padding(.top, 6)
    }

    /// [不具合修正・2026-08-04(6訂)] `label`をプレーンな`String`にしていたため、
    /// `Text(label)`がローカライズ検索(Localizable.xcstrings)を経由せず
    /// 常に日本語のまま表示されていた(SwiftUIは文字列リテラルが直接
    /// `LocalizedStringKey`型のパラメータに渡された場合のみ自動でローカライズ
    /// 変換する。一度`String`型の変数に代入してから`Text`に渡すと、その変換は
    /// 起きない)。`LocalizedStringKey`に変更し、呼び出し側のリテラルが
    /// カタログ経由で翻訳されるようにした。
    private func tabBarButton(tab: RootTab, systemImage: String, label: LocalizedStringKey) -> some View {
        let isSelected = selectedTab == tab
        return Button {
            selectedTab = tab
        } label: {
            VStack(spacing: 3) {
                Image(systemName: systemImage)
                    .font(.system(size: 19))
                Text(label)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
            }
            .foregroundColor(isSelected ? .pttAccent : .pttMuted)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background {
                if isSelected {
                    Capsule().fill(Color.pttAccentDim.opacity(0.55))
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .animation(.easeOut(duration: 0.15), value: isSelected)
    }

    /// Talkタブ。未入室=ルーム選択画面、入室中=PTTボタン+退出ボタンを表示する。
    /// 「入室後は通話ボタン＋ルーム退出ボタンも表示」という要件に合わせ、退出ボタン
    /// (voiceSection)はこのタブの下部に据える(旧: Moreタブに分離されていた)。
    /// [不具合修正・2026-08-04] TabViewの各ページはVStack側の`.background(.pttBackground)`を
    /// 継承せず、既定の(ライトモードでは白い)ページ背景で描画されてしまう
    /// (foregroundColorはSwiftUIの環境値として伝播するため文字色自体は正しいが、
    /// 白背景に暗色パレットの文字色が乗ることで「文字が薄く見える」現象が起きていた)。
    /// 各タブのルートに明示的に背景を敷いて解決する。
    @ViewBuilder
    private var talkTabContent: some View {
        Group {
            if activeRoomId != nil {
                VStack(spacing: 0) {
                    Spacer(minLength: 0)
                    talkArea
                    Spacer(minLength: 0)
                    voiceSection
                }
            } else {
                ScrollView {
                    roomSelectionSection
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.pttBackground.ignoresSafeArea())
    }

    /// 参加者タブ。未入室中はそもそも参加者情報が存在しないため案内文のみを表示する。
    @ViewBuilder
    private var membersTabContent: some View {
        Group {
            if activeRoomId != nil {
                ScrollView { talkerSection }
            } else {
                emptyTabPlaceholder(
                    systemImage: "person.2",
                    message: String(localized: "ルームに参加すると参加者一覧が表示されます")
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.pttBackground.ignoresSafeArea())
    }

    /// チャットタブ。未入室中は案内文のみを表示する。
    @ViewBuilder
    private var chatTabContent: some View {
        Group {
            if activeRoomId != nil {
                chatSection
            } else {
                emptyTabPlaceholder(
                    systemImage: "bubble.left.and.bubble.right",
                    message: String(localized: "ルームに参加するとチャットが利用できます")
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.pttBackground.ignoresSafeArea())
    }

    /// 設定タブ(旧Moreタブ)。プロフィール(旧ヘッダーのLoginStatusIcon相当)・
    /// 接続設定(旧ヘッダーのPTTSettingsIcon相当)を新たに集約し、入室中のみ
    /// 意味を持つ操作(ゲストのニックネーム変更・録音操作)はそれに続けて表示する。
    /// [不具合修正・2026-08-04(3訂)] 他タブと違い共通ヘッダー(ルーム状態)を
    /// 表示しないため、代わりに簡単なタイトルとセーフエリア分の余白を確保する。
    private var settingsTabContent: some View {
        ScrollView {
            VStack(spacing: 0) {
                Text("設定")
                    .font(.system(size: 11, weight: .regular, design: .monospaced))
                    .foregroundColor(.pttMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)

                profileSection
                Divider().overlay(Color.pttLine).padding(.horizontal, 14)
                connectionSettingsSection
                if activeRoomId != nil {
                    Divider().overlay(Color.pttLine).padding(.horizontal, 14)
                    guestStatusSection
                    recordingControlsSection
                }
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.pttBackground.ignoresSafeArea())
    }

    /// 参加者/チャットタブを未入室中に開いた場合の空状態表示。
    private func emptyTabPlaceholder(systemImage: String, message: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: systemImage)
                .font(.system(size: 28))
                .foregroundColor(.pttMuted)
            Text(message)
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(.pttMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(40)
    }

    // MARK: - Settings tab: profile (旧ヘッダーのLoginStatusIcon相当)

    /// アバター・表示名・サインアウトをまとめたプロフィール行。
    /// 従来ヘッダーの丸アイコン+Menuだった導線を、設定タブ内の常時表示行に置き換えた。
    private var profileSection: some View {
        HStack(spacing: 12) {
            profileAvatar
            VStack(alignment: .leading, spacing: 2) {
                Text(headerDisplayName.isEmpty ? String(localized: "ニックネーム未設定") : headerDisplayName)
                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                Text(auth.currentUser?.isAnonymous == true ? String(localized: "ゲストとしてログイン中") : String(localized: "ログイン中"))
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.pttMuted)
            }
            Spacer()
            Button(role: .destructive) {
                leaveRoom()
                auth.signOut()
            } label: {
                Image(systemName: "rectangle.portrait.and.arrow.right")
                    .font(.system(size: 14))
            }
            .accessibilityLabel(String(localized: "サインアウト"))
        }
        .padding(14)
    }

    @ViewBuilder
    private var profileAvatar: some View {
        ZStack {
            Circle().fill(Color.pttPanel)
            Circle().strokeBorder(Color.pttLine, lineWidth: 1)
            if let photoURL = auth.currentUser?.photoURL {
                AsyncImage(url: photoURL) { phase in
                    if case .success(let image) = phase {
                        image.resizable().scaledToFill()
                    } else {
                        Image(systemName: "person.fill").font(.system(size: 15)).foregroundColor(.pttMuted)
                    }
                }
                .frame(width: 40, height: 40)
                .clipShape(Circle())
            } else {
                Image(systemName: "person.fill").font(.system(size: 15)).foregroundColor(.pttMuted)
            }
        }
        .frame(width: 40, height: 40)
    }

    // MARK: - Settings tab: 接続設定(旧ヘッダーのPTTSettingsIcon相当)

    /// 接続先(トークンサーバー/LiveKit)設定へのエントリ行。従来はヘッダーの
    /// 歯車アイコンから即シート表示していたが、設定タブ内の1行に変更した
    /// (PTTSettingsView自体は変更なくシートとして再利用する)。
    private var connectionSettingsSection: some View {
        Button {
            isConnectionSettingsPresented = true
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "server.rack")
                    .foregroundColor(.pttMuted)
                Text("接続設定(サーバー/LiveKit)")
                    .font(.system(size: 12, design: .monospaced))
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 11))
                    .foregroundColor(.pttMuted)
            }
        }
        .buttonStyle(.plain)
        .foregroundColor(.pttText)
        .padding(14)
        .sheet(isPresented: $isConnectionSettingsPresented) {
            PTTSettingsView(settings: settingsStore)
        }
    }

    // MARK: - Auth

    /// 未サインイン時の画面。Web版のauthSectionに相当。
    /// [モバイルUI再編・2026-08-04(再改定)] 画面全体を上下左右中央揃えにし、
    /// iOS 26 Liquid Glass(`.glassEffect`)に準拠したカード1枚で構成する。
    private var authSection: some View {
        ZStack {
            Color.pttBackground.ignoresSafeArea()

            // [Liquid Glass] ガラス越しに背景の質感が見えるよう、うっすらとした
            // アクセントカラーの円をぼかして背後に置く(素の単色背景だとガラスの
            // 透過・屈折表現がほぼ視認できないため)。
            Circle()
                .fill(Color.pttAccent.opacity(0.25))
                .frame(width: 260, height: 260)
                .blur(radius: 90)
                .offset(x: -80, y: -160)
            Circle()
                .fill(Color.pttLive.opacity(0.18))
                .frame(width: 220, height: 220)
                .blur(radius: 90)
                .offset(x: 100, y: 180)

            GlassEffectContainer(spacing: 14) {
                VStack(spacing: 22) {
                    VStack(spacing: 6) {
                        Image(systemName: "mic.circle.fill")
                            .font(.system(size: 44))
                            .foregroundStyle(.pttAccent)
                        Text("PTT CLIENT")
                            .font(.system(size: 13, weight: .semibold, design: .monospaced))
                            .foregroundColor(.pttMuted)
                        Text("人ではなく、場につながる。")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(.pttMuted)
                    }

                    authButtons

                    Text("ゲストは登録不要ですが、送信内容や参加履歴は削除されず保持されます。")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(.pttMuted)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)

                    if let message = auth.lastErrorMessage {
                        Text(message)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(.pttDanger)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(28)
                .frame(maxWidth: 340)
                .glassEffect(.regular.tint(.pttPanel).interactive(), in: RoundedRectangle(cornerRadius: 28))
            }
            .padding(24)
        }
        // [設定] 未サインイン時も接続先(トークンサーバー/LiveKit)を変更できるよう、
        // ガラスカードの右上に小さく歯車アイコンを重ねる(サインイン後は設定タブへ移動)。
        .overlay(alignment: .topTrailing) {
            PTTSettingsIcon(settings: settingsStore)
                .glassEffect(.regular, in: Circle())
                .padding(20)
        }
    }

    /// Google/ゲストサインインの2ボタン。主操作(Googleサインイン)は塗りつぶしで
    /// 目立たせたいため`.buttonStyle(.glassProminent)`、副次操作(ゲスト参加)は
    /// カードのガラスに馴染む`.buttonStyle(.glass)`(ニュートラル)を使い分ける。
    /// [不具合修正・2026-08-04(5訂)] 当初は両方とも`.glass`+`.tint()`にしていたが、
    /// 実機では`.tint()`が反映されず両方とも同じニュートラルな見た目になって
    /// しまうことが判明した(`.glass`はニュートラルな質感を保つスタイルで、
    /// 色付き塗りつぶしにするには`.glassProminent`が必要だった)。
    private var authButtons: some View {
        VStack(spacing: 12) {
            Button {
                Task { await auth.signInWithGoogle() }
            } label: {
                Text(auth.isSigningIn ? String(localized: "サインイン中...") : String(localized: "Googleでサインイン"))
                    .font(.system(size: 13, weight: .medium, design: .monospaced))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.glassProminent)
            .tint(.pttAccent)
            .disabled(auth.isSigningIn)

            Button {
                Task { await auth.signInAsGuest() }
            } label: {
                Text(String(localized: "ゲストとして参加"))
                    .font(.system(size: 13, weight: .medium, design: .monospaced))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.glass)
            .disabled(auth.isSigningIn)
        }
    }

    // MARK: - Header

    /// [不具合修正・2026-08-04(6訂)] 従来はここに固定文言「PTT CLIENT」+
    /// ConnectionStatusIconの丸アイコン(接続状態を頭文字1文字で表す)を表示していたが、
    /// ユーザー指摘により「アプリ名の静的表示」「アイコンだけでは何の状態か
    /// 分かりにくい」の2点を解消するため、組織名(左)と接続状態のドット+テキスト(右)を
    /// 直接ヘッダーに並べる形へ変更した。接続状態のドット色・文言は元々statusRowが
    /// 持っていたstatusColor/statusTextをそのまま流用し、statusRow自体は
    /// (room=...)付きの表示がここと重複するため廃止した(statusTextから
    /// room=...部分も削除済み。詳細はstatusText参照)。
    private func header() -> some View {
        HStack(spacing: 10) {
            if let orgName = orgContext.orgName {
                Text(orgName)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundColor(.pttMuted)
                    .lineLimit(1)
            }
            Spacer()
            HStack(spacing: 6) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 7, height: 7)
                Text(statusText)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.pttMuted)
            }
        }
        .padding(14)
    }

    /// ヘッダーに表示する名前。Google/Appleサインインならプロフィール名/メール、
    /// Guest(匿名認証)の場合はauth.displayNameがnilになるため、入室中ならニックネーム、
    /// 未入室ならラベル文字列にフォールバックする。
    private var headerDisplayName: String {
        if let name = auth.displayName { return name }
        if auth.currentUser?.isAnonymous == true {
            return ban.myDisplayName ?? String(localized: "ゲスト")
        }
        return ""
    }

    // MARK: - Status

    private var statusColor: Color {
        switch connection.status {
        case .connected: return .pttLive
        case .reconnecting: return .pttWarning // 黄色系: 再接続試行中であることを目立たせる
        case .error: return .pttDanger
        default: return .pttMuted
        }
    }

    private var statusText: String {
        switch connection.status {
        case .disconnected: return String(localized: "サーバ未接続")
        case .connecting: return String(localized: "接続中...")
        case .connected:
            return String(localized: "status_header_connected", defaultValue: "接続中", comment: "Header connection status: connected")
        case .reconnecting:
            return String(localized: "status_header_reconnecting", defaultValue: "再接続中...", comment: "Header connection status: reconnecting")
        case .error(let message):
            return String(format: NSLocalizedString("エラー: %@", comment: "Error status"), message)
        }
    }

    // MARK: - Room selection (招待コードで参加)

    /// サインイン済み・未入室時の画面。Web版のRoomSelectView.vueに相当。
    private var roomSelectionSection: some View {
        VStack(spacing: 10) {
            if let banNotice {
                Text(banNotice)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundColor(.pttDanger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            HStack(spacing: 10) {
                field(label: "ルームID", text: $joinRoomId, placeholder: "招待された側が入力")
                field(label: "招待コード", text: $joinInviteCode, placeholder: "8文字のコード")
            }
            Button(action: handleJoinRoom) {
                Text(roomManager.isWorking ? String(localized: "参加中...") : String(localized: "招待コードで参加する"))
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.glassProminent)
            .tint(.pttAccent)
            .disabled(roomManager.isWorking)

            // [招待リンク/QR] アプリ内QRスキャナーの起動ボタン。読み取り結果は
            // 入力欄への反映のみ(自動参加はしない。deeplink-qr-join-plan.md参照)。
            Button(action: { isQrScannerPresented = true }) {
                Text("QRコードを読み取る")
                    .font(.system(size: 13, design: .monospaced))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
            }
            .buttonStyle(.glass)
            .sheet(isPresented: $isQrScannerPresented) {
                QRScannerView(
                    onDecoded: { invite in
                        joinRoomId = invite.roomId
                        joinInviteCode = invite.inviteCode
                        isQrScannerPresented = false
                    },
                    onCancel: { isQrScannerPresented = false }
                )
            }

            if let message = roomManager.lastErrorMessage {
                Text(message)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.pttDanger)
            }

            if !savedRooms.rooms.isEmpty {
                Text("— 最近使ったルーム —")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(.pttMuted)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 4)

                // [モバイルUI再編・2026-08-04] 従来は行末に小さな「削除」テキストリンクを
                // 置いていたが、誤タップしやすく・見つけにくい。iOS標準のスワイプ削除
                // (.swipeActions)に変更し、発見しやすさと誤操作防止を両立させる。
                // Listは親のScrollView内で高さが定まらないため、行数から概算した
                // 高さを明示し、スクロールは親側に任せる(scrollDisabled)。
                List {
                    ForEach(savedRooms.rooms) { saved in
                        savedRoomRow(saved)
                            .listRowInsets(EdgeInsets())
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button(role: .destructive) {
                                    savedRooms.remove(roomId: saved.roomId)
                                } label: {
                                    Label(String(localized: "削除"), systemImage: "trash")
                                }
                            }
                    }
                }
                .listStyle(.plain)
                .scrollDisabled(true)
                .scrollContentBackground(.hidden)
                .frame(height: CGFloat(savedRooms.rooms.count) * 58)
            }
        }
        .padding(14)
    }

    private func savedRoomRow(_ saved: PTTSavedRoomsStore.SavedRoom) -> some View {
        Button {
            rejoinSavedRoom(saved)
        } label: {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(saved.label)
                        .font(.system(size: 13, design: .monospaced))
                        .lineLimit(1)
                    Text("(\(saved.roomId))")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(.pttMuted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.pttMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
        }
        .buttonStyle(.plain)
        .background(.pttPanel.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
        .padding(.vertical, 3)
    }

    // MARK: - Guest status (Phase10: Guestロール 5.1)

    /// 自分がGuest(匿名認証)の場合のみ表示するバッジ+ニックネーム変更UI。
    /// 他の参加者がGuestかどうかはこのクライアントからは判定できない
    /// (firestore.rulesにより自分自身のmembersドキュメントしか読めないため)ので、
    /// ここで扱うのは常に自分自身の状態のみ。Web版のGuestStatusBar.vueに相当。
    @ViewBuilder
    private var guestStatusSection: some View {
        if ban.myRole == "guest" {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text("ゲスト")
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color.pttAccent.opacity(0.15), in: Capsule())
                        .overlay(Capsule().stroke(Color.pttAccent, lineWidth: 1))
                        .foregroundColor(.pttAccent)

                    if isEditingNickname {
                        TextField("ニックネーム", text: $nicknameDraft)
                            .font(.system(size: 12, design: .monospaced))
                            .padding(6)
                            .background(.pttPanel.opacity(0.6))
                            .frame(maxWidth: 160)
                            .onSubmit { submitNicknameChange() }

                        Button(ban.nicknameUpdating ? String(localized: "保存中...") : String(localized: "保存")) {
                            submitNicknameChange()
                        }
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(.pttAccent)
                        .disabled(ban.nicknameUpdating)

                        Button(String(localized: "キャンセル")) {
                            isEditingNickname = false
                        }
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(.pttMuted)
                    } else {
                        Text(ban.myDisplayName ?? String(localized: "ニックネーム未設定"))
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundColor(.pttMuted)

                        Button(String(localized: "ニックネームを変更")) {
                            nicknameDraft = ban.myDisplayName ?? ""
                            isEditingNickname = true
                        }
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(.pttMuted)
                    }
                }

                if let message = ban.nicknameErrorMessage {
                    Text(message)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(.pttDanger)
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 10)
        }
    }

    private func submitNicknameChange() {
        let trimmed = nicknameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let roomId = activeRoomId else { return }
        isEditingNickname = false
        Task {
            do {
                let idToken = try await auth.fetchIDToken()
                try await ban.updateNickname(tokenServerURL: tokenServerURL, idToken: idToken, roomId: roomId, displayName: trimmed)
            } catch {
                // ban.nicknameErrorMessage に理由がセットされているのでUIには既に反映済み
            }
        }
    }

    // MARK: - Recording (録音開始/停止UI)

    /// [モバイルUI再編・2026-08-04] 録音中であることの開示(赤バッジ+経過時間+同意文言)。
    /// Web版 RecordingBar.vue の移植部分のうち、ロールに関わらず全参加者へ
    /// 常時表示する必要がある部分(法的な同意の観点で必須)。
    /// タブ内に置くとタブを切り替えた瞬間に開示が見えなくなってしまうため、
    /// TabViewの外側(全タブ共通のヘッダー領域)に置く前提で切り出した。
    @ViewBuilder
    private var recordingBanner: some View {
        if connection.isRecording {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Circle()
                        .fill(.pttDanger)
                        .frame(width: 7, height: 7)
                    Text("録音中")
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundColor(.pttDanger)
                    if let startedAt = connection.recordingStartedAt {
                        TimelineView(.periodic(from: startedAt, by: 1)) { _ in
                            Text(elapsedLabel(since: startedAt))
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundColor(.pttMuted)
                        }
                    }
                }
                Text("このルームの通話内容は録音され、モデレーターが確認できます。")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(.pttMuted)
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 10)
        }
    }

    /// [モバイルUI再編・2026-08-04] 録音の開始/停止ボタン本体。頻度の低い操作のため
    /// Moreタブへ移設した(開示バナー自体はrecordingBannerとして常時表示を維持)。
    /// owner/moderatorのみ表示する(サーバー側でも権限を再チェックする)。
    @ViewBuilder
    private var recordingControlsSection: some View {
        if canControlRecording {
            VStack(alignment: .leading, spacing: 8) {
                Text("録音操作")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(.pttMuted)

                HStack(spacing: 10) {
                    if connection.isRecording {
                        Button(recording.stopping ? String(localized: "停止中...") : String(localized: "録音を停止")) {
                            stopRecording()
                        }
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundColor(.pttDanger)
                        .disabled(recording.stopping)
                    } else {
                        Button(recording.starting ? String(localized: "開始中...") : String(localized: "録音を開始")) {
                            showRecordingStartConfirm = true
                        }
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundColor(.pttAccent)
                        .disabled(recording.starting)
                    }
                }

                if let message = recording.errorMessage {
                    Text(message)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(.pttDanger)
                }
            }
            .padding(14)
        }
    }

    /// owner/moderatorのみ録音の開始/停止を操作できる(サーバー側でも権限を再チェックする)。
    /// [Phase12・十五訂] role分岐はPTTRoomPermissions.swiftに集約(token-server/lib/permissions.jsとCI同期)。
    private var canControlRecording: Bool {
        PTTRoomPermissions.canManageRoom(role: ban.myRole)
    }

    /// 録音開始からの経過時間を "mm:ss" 形式で表示する。Web版RecordingBar.vueの
    /// elapsedLabel(1秒毎に再計算する経過時間表示。実際の録音中判定には使わない)と同じ役割。
    private func elapsedLabel(since startedAt: Date) -> String {
        let totalSeconds = max(0, Int(Date().timeIntervalSince(startedAt)))
        return String(format: "%02d:%02d", totalSeconds / 60, totalSeconds % 60)
    }

    private func startRecording() {
        showRecordingStartConfirm = false
        guard let roomId = activeRoomId else { return }
        Task {
            do {
                let idToken = try await auth.fetchIDToken()
                try await recording.startRecording(tokenServerURL: tokenServerURL, idToken: idToken, roomId: roomId)
            } catch {
                // recording.errorMessage に理由がセットされているのでUIには既に反映済み
            }
        }
    }

    private func stopRecording() {
        guard let roomId = activeRoomId else { return }
        Task {
            do {
                let idToken = try await auth.fetchIDToken()
                try await recording.stopRecording(tokenServerURL: tokenServerURL, idToken: idToken, roomId: roomId)
            } catch {
                // recording.errorMessage に理由がセットされているのでUIには既に反映済み
            }
        }
    }

    // MARK: - Report (通報UI)

    /// Web版RoomView.vueの`reportParticipant`に相当。理由入力後、
    /// token-server/routes/reports.js の POST /reports を呼ぶ。
    private func submitReport(_ target: PTTParticipantInfo) {
        let reason = reportReasonText.trimmingCharacters(in: .whitespacesAndNewlines)
        reportTarget = nil
        reportReasonText = ""
        guard !reason.isEmpty, let roomId = activeRoomId else { return }
        Task {
            do {
                let idToken = try await auth.fetchIDToken()
                try await report.submitReport(tokenServerURL: tokenServerURL, idToken: idToken, roomId: roomId, reportedUid: target.uid, reason: reason)
            } catch {
                // report.errorMessage に理由がセットされているのでUIには既に反映済み
            }
        }
    }

    /// [見出し・アイコンの表示名切り替え・再訂正] Roomが組織(orgId)に紐づく場合、
    /// 最下層のノード名を優先して使う(同名の組織が複数の支社・現場を持つ場合、
    /// 最上位の組織名だけでは区別がつかないため)。ノード未割り当ての場合は
    /// 組織名、無所属Roomはルーム名を使う。Web版RoomView.vueのdisplayNameに相当。
    private var displayName: String? {
        if let leaf = orgContext.breadcrumb.last {
            return leaf.name
        }
        return orgContext.orgName ?? currentRoomName
    }

    /// [見出し] 組織に紐づくRoomは最下層のノード名(無ければ組織名)、無所属Roomは
    /// ルーム名を表示する。未設定の場合は表示しない(roomIdはstatusRow側で常に
    /// 表示されるため、名前は補助的な表示)。Web版RoomView.vueの
    /// `<h1 v-if="displayName">`に相当。
    @ViewBuilder
    private var roomNameHeader: some View {
        if let name = displayName {
            Text(name)
                .font(.system(size: 15, weight: .semibold, design: .monospaced))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.top, 10)
        }
        orgBreadcrumbRow
    }

    /// [組織階層内の祖先パンくず表示] Web版RoomView.vueの`<OrgBreadcrumb>`に相当。
    /// 最下層のノード名はdisplayName(見出し)側で既に表示されているため、ここでは
    /// 「組織名 › 祖先ノード…」という、最下層を除いた祖先経路のみを表示する。
    /// breadcrumbが空(Room=組織直下でノード未割り当て)の場合、見出し側がorgNameを
    /// 表示するため、ここでは何も表示しない(無所属Roomの場合と同じ方針)。
    @ViewBuilder
    private var orgBreadcrumbRow: some View {
        if let orgName = orgContext.orgName, !orgContext.breadcrumb.isEmpty {
            let ancestorNodes = orgContext.breadcrumb.dropLast()
            HStack(spacing: 4) {
                Text(orgName)
                ForEach(ancestorNodes) { node in
                    Text("›")
                    Text(node.name)
                }
            }
            .font(.system(size: 11, design: .monospaced))
            .foregroundColor(.pttMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.bottom, 2)
        }
    }

    /// 入室後: 退出ボタン。Web版のleaveRoomBtnに相当。
    /// [ボタンデザイン再検討・2026-08-04] 従来はWeb版の枠線ボタン(角丸2pt・
    /// pttMuted文字色)をそのまま踏襲していたが、iOSでは馴染みが薄いという
    /// 指摘を受け、role: .destructiveを持つボタンに変更した。
    /// [不具合修正・2026-08-04(5訂)] role: .destructiveや`.tint()`だけでは
    /// 実機で赤系に着色されず(通常時は白文字、タップ時はただの白っぽい
    /// ハイライトになっていた)、退出という破壊的操作なのに見た目上それと
    /// 分からなかった。原因は`.buttonStyle(.glass)`がニュートラルな質感を保つ
    /// スタイルで、色付き塗りつぶしには`.glassProminent`が必要だったため
    /// (authButtons参照)。`.glassProminent` + `.tint(.pttDanger)`に変更し、
    /// 通常時・押下時とも赤系で統一されるようにした。
    private var voiceSection: some View {
        Button(role: .destructive, action: leaveRoom) {
            Text("ルームを退出する")
                .font(.system(size: 14, weight: .medium, design: .monospaced))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
        }
        .buttonStyle(.glassProminent)
        .tint(.pttDanger)
        .padding(14)
    }

    private func field(label: LocalizedStringKey, text: Binding<String>, placeholder: LocalizedStringKey = "") -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.pttMuted)
            TextField(placeholder, text: text)
                .font(.system(size: 14, design: .monospaced))
                .padding(10)
                .background(.pttPanel.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
        }
    }

    private var isConnected: Bool {
        if case .connected = connection.status { return true }
        return false
    }

    /// [送話ロック連携] 自分以外が発話ロックを保持しているか。
    /// trueの間はPTTボタンを無効化し、「誰が話しているか」を表示する。
    private var someoneElseIsTalking: Bool {
        guard let talkerUid = connection.currentTalkerUid else { return false }
        return talkerUid != auth.currentUser?.uid
    }

    /// 現在発話ロックを保持している相手の表示名(自分以外の場合のみ意味を持つ)。
    private var currentTalkerName: String {
        guard let talkerUid = connection.currentTalkerUid else { return "" }
        return connection.participants[talkerUid]?.name ?? talkerUid
    }

    private func handleJoinRoom() {
        let roomId = joinRoomId.trimmingCharacters(in: .whitespacesAndNewlines)
        let inviteCode = joinInviteCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !roomId.isEmpty, !inviteCode.isEmpty else { return }
        roomManager.clearError()
        Task {
            do {
                let idToken = try await auth.fetchIDToken()
                let name = try await roomManager.joinRoom(tokenServerURL: tokenServerURL, idToken: idToken, roomId: roomId, inviteCode: inviteCode)
                currentRoomName = name
                savedRooms.upsert(roomId: roomId, label: name ?? String(localized: "招待コードで参加したルーム"), inviteCode: inviteCode)
                enterRoom(roomId)
            } catch {
                // roomManager.lastErrorMessage に理由がセットされているのでUIには既に反映済み
            }
        }
    }

    /// 保存済みのルームをタップした場合: 招待コード検証(/rooms/:id/join)は経由せず、
    /// 既にメンバーである前提でそのままトークン取得〜接続に進む。
    /// (メンバーでなくなっていた場合 = BAN等 は /token が403を返すのでconnection側のエラー表示に出る)
    private func rejoinSavedRoom(_ saved: PTTSavedRoomsStore.SavedRoom) {
        // /join を経由しないため、ルーム名は未取得の状態からスタートする。
        // enterRoom側でfetchRoomName()を呼んで最新値を取り直す(admin-dashboard側で
        // 変更されている可能性もあるため、Web版と同じく入室のたびに取り直す)。
        currentRoomName = nil
        enterRoom(saved.roomId)
    }

    private func enterRoom(_ roomId: String) {
        banNotice = nil
        activeRoomId = roomId
        chat.start(roomId: roomId)
        ban.start(roomId: roomId, uid: auth.currentUser?.uid ?? "")
        badges.start(
            tokenServerURL: tokenServerURL,
            roomId: roomId,
            idTokenProvider: { try await auth.fetchIDToken() }
        )
        // [パンくず表示] 変化頻度が低いため入室時に1回だけ取得する(badges.startの
        // ようなポーリングはしない。PTTOrgContextStore参照)。
        orgContext.fetchOnce(
            tokenServerURL: tokenServerURL,
            roomId: roomId,
            idTokenProvider: { try await auth.fetchIDToken() }
        )
        connection.connect(
            tokenServerURL: tokenServerURL,
            livekitURL: livekitURL,
            room: roomId,
            idTokenProvider: { try await auth.fetchIDToken() }
        )
        // [ルーム名] /join を経由しない再入室や、入室後にadmin-dashboard側で
        // 名前が変更された場合にも対応できるよう、入室のたびに最新値を取り直す
        // (Web版RoomView.vueの`enter()`が毎回fetchAutoRecordingを呼ぶのと同じ方針)。
        Task {
            let idToken = try? await auth.fetchIDToken()
            guard let idToken, activeRoomId == roomId else { return }
            if let name = await roomManager.fetchRoomName(tokenServerURL: tokenServerURL, idToken: idToken, roomId: roomId) {
                currentRoomName = name
            }
        }
    }

    private func leaveRoom() {
        if connection.status != .disconnected { connection.disconnect() }
        chat.stop()
        ban.stop()
        badges.stop()
        orgContext.reset()
        activeRoomId = nil
        currentRoomName = nil
        joinRoomId = ""
        joinInviteCode = ""
        chatInputText = ""
        chatPendingAttachmentData = nil
        chatPendingAttachmentFileName = nil
        chatPendingAttachmentContentType = nil
        chatThumbnailImages = [:]
    }

    /// [BAN対応] BAN確認ダイアログで「BANする」を選んだ際に呼ばれる。
    private func confirmBan(_ target: PTTParticipantInfo) {
        banTarget = nil
        guard let roomId = activeRoomId else { return }
        Task {
            do {
                let idToken = try await auth.fetchIDToken()
                try await ban.banParticipant(tokenServerURL: tokenServerURL, idToken: idToken, roomId: roomId, targetUid: target.uid)
            } catch {
                // ban.errorMessage に理由がセットされているのでUIには既に反映済み
            }
        }
    }

    // MARK: - Talk area (PTT button)

    /// [送話ロック連携] 自分以外が発話ロックを保持している間はボタンのヒットテストを無効化し、
    /// 「誰が話しているか」を表示する。実際のロック取得/解放は
    /// connection.startTalking()/stopTalking() が担う(このView自身はサーバーを呼ばない)。
    private var talkArea: some View {
        let canTalk = isConnected && !someoneElseIsTalking
        return VStack(spacing: 14) {
            Circle()
                .strokeBorder(connection.isSending ? Color.pttAccent : .pttLine, lineWidth: 2)
                .background(Circle().fill(.pttPanel.opacity(0.6)))
                .frame(width: 150, height: 150)
                .overlay(
                    Text(talkAreaLabel)
                        .font(.system(size: 13, design: .monospaced))
                        .multilineTextAlignment(.center)
                        .foregroundColor(connection.isSending ? .pttAccent : .pttMuted)
                        .padding(.horizontal, 10)
                )
                .scaleEffect(connection.isSending ? 0.97 : 1.0)
                .opacity(canTalk ? 1.0 : 0.3)
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { _ in connection.startTalking() }
                        .onEnded { _ in connection.stopTalking() }
                )
                .allowsHitTesting(canTalk)

            Text("ボタンを押している間だけ音声が送信されます")
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(.pttMuted)
        }
        .padding(.vertical, 24)
    }

    private var talkAreaLabel: String {
        if connection.isSending { return String(localized: "送話中") }
        if someoneElseIsTalking {
            return String(format: NSLocalizedString("%@ が送話中", comment: "Someone else is talking"), currentTalkerName)
        }
        return String(localized: "押して送話")
    }

    // MARK: - Talkers / Participants

    /// [BAN対応] Web版の「参加者(緑=送話中)」に相当。以前は送話中の相手だけを
    /// チップで表示していたが、BAN対象を選べるよう全参加者を一覧表示するように変更した。
    private var talkerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("参加者(緑=送話中)")
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.pttMuted)

            if connection.participants.isEmpty {
                Text("— なし —")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.pttMuted)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(sortedParticipants) { info in
                        participantRow(info)
                    }
                }
            }

            if let reportError = report.errorMessage {
                Text(reportError)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.pttDanger)
            }

            // [Phase13] バッジ取得エラーは表示専用の補助情報の失敗にすぎないため、
            // Web版と同じく致命的エラー扱いにはせず、控えめに表示するのみに留める。
            if let badgeError = badges.errorMessage {
                Text(badgeError)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(.pttMuted)
            }

            // [2026-08-04・次アクションitem4] Room owner向けバッジ付与/剥奪。
            // Web版ParticipantList.vueの移植。grantableBadgesがnilの間
            // (=ownerでない、または未取得)は何も出さない(サーバー側がowner以外には
            // nullを返すため、role判定をここで重複させない)。
            badgeManageSection
        }
        .padding(14)
    }

    @ViewBuilder
    private var badgeManageSection: some View {
        if let grantableBadges = badges.grantableBadges, !connection.participants.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("バッジの付与/剥奪")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(.pttMuted)

                if let grantError = badges.grantErrorMessage {
                    Text(grantError)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(.pttDanger)
                }

                ForEach(sortedParticipants) { info in
                    badgeManageRow(info, grantableBadges: grantableBadges)
                }
            }
            .padding(.top, 6)
        }
    }

    /// [2026-08-04・次アクションitem4] 1参加者分のバッジ付与/剥奪行。
    /// 現在付与済みのバッジ(source == "grant"のみ。Guestの役割バッジは対象外)を
    /// 剥奪ボタン付きで表示し、未付与のバッジをMenuから選んで付与できるようにする。
    private func badgeManageRow(_ info: PTTParticipantInfo, grantableBadges: [PTTGrantableBadge]) -> some View {
        let owned = Set((badges.allBadges[info.uid] ?? []).map(\.badgeId))
        let selectableBadges = grantableBadges.filter { !owned.contains($0.badgeId) }

        return HStack(spacing: 6) {
            Text(info.name)
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.pttMuted)
                .lineLimit(1)
                .frame(minWidth: 60, alignment: .leading)

            ForEach((badges.allBadges[info.uid] ?? []).filter { $0.source == "grant" }, id: \.badgeId) { badge in
                Button {
                    confirmRevokeBadge(info, badgeId: badge.badgeId)
                } label: {
                    Text("\(badge.icon) \(badge.name) ✕")
                        .font(.system(size: 10, design: .monospaced))
                }
                .disabled(badges.isGranting)
            }

            if !selectableBadges.isEmpty {
                Menu {
                    ForEach(selectableBadges) { badge in
                        Button("\(badge.icon) \(badge.name)") {
                            confirmGrantBadge(info, badgeId: badge.badgeId)
                        }
                    }
                } label: {
                    Text("付与...")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(.pttAccent)
                }
                .disabled(badges.isGranting)
            }
        }
    }

    /// バッジ付与ボタン押下時に呼ばれる。BANと異なり誤操作時の被害が小さい
    /// (取消可能な役割表示にすぎない)ため、確認ダイアログは挟まずMenu選択で即実行する。
    private func confirmGrantBadge(_ target: PTTParticipantInfo, badgeId: String) {
        guard let roomId = activeRoomId else { return }
        Task {
            do {
                let idToken = try await auth.fetchIDToken()
                try await badges.grantBadge(tokenServerURL: tokenServerURL, idToken: idToken, roomId: roomId, targetUid: target.uid, badgeId: badgeId)
            } catch {
                // badges.grantErrorMessage に理由がセットされているのでUIには既に反映済み
            }
        }
    }

    private func confirmRevokeBadge(_ target: PTTParticipantInfo, badgeId: String) {
        guard let roomId = activeRoomId else { return }
        Task {
            do {
                let idToken = try await auth.fetchIDToken()
                try await badges.revokeBadge(tokenServerURL: tokenServerURL, idToken: idToken, roomId: roomId, targetUid: target.uid, badgeId: badgeId)
            } catch {
                // badges.grantErrorMessage に理由がセットされているのでUIには既に反映済み
            }
        }
    }

    private var sortedParticipants: [PTTParticipantInfo] {
        connection.participants.values.sorted { $0.name < $1.name }
    }

    /// owner/moderatorのみBANボタンを表示する(サーバー側でも権限を再チェックする)。
    /// [Phase12・十五訂] role分岐はPTTRoomPermissions.swiftに集約(token-server/lib/permissions.jsとCI同期)。
    private var canBan: Bool {
        PTTRoomPermissions.canManageRoom(role: ban.myRole)
    }

    private func participantRow(_ info: PTTParticipantInfo) -> some View {
        HStack(spacing: 8) {
            // [Phase13 バッジ表示] Web版ParticipantList.vueの
            // `<span :title="topBadges[p.identity]!.name">{{ icon }}</span>` に相当。
            // 最優先1件のみ表示(Room内・参加者一覧での表示仕様、5.3参照)。
            if let topBadge = badges.topBadge(for: info.uid) {
                Text(topBadge.icon)
                    .font(.system(size: 12))
                    .accessibilityLabel(topBadge.name)
            }

            Text(info.name)
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(info.isMuted ? .pttMuted : .pttLive)
                .lineLimit(1)

            Spacer()

            Button("通報") {
                reportTarget = info
                reportReasonText = ""
            }
            .font(.system(size: 11, design: .monospaced))
            .foregroundColor(.pttMuted)

            if canBan {
                Button("BAN") {
                    banTarget = info
                }
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundColor(.pttDanger)
            }
        }
    }

    // MARK: - Chat (Phase5 + Phase16添付ファイル)

    /// テキストチャット。書き込みはtoken-server経由、配信・履歴はFirestoreの
    /// リアルタイムリスナー(PTTChatStore)に任せる。BANされた瞬間、
    /// firestore.rules側で読み取り自体もできなくなる。
    ///
    /// [Phase16] Web版(ptt-client/src/components/ChatPanel.vue)の移植。
    /// 画像/動画/PDFの添付に対応。選択直後には送信せず、送信ボタンが
    /// 押されるまで`chatPendingAttachment*`に保持しておく(Web版のpendingFileと同じ)。
    private var chatSection: some View {
        // [モバイルUI再編・2026-08-04] Chatタブの中身がそのままタブ全体を占めるよう、
        // 縦方向いっぱいに広げる(以前は他セクションと縦に並ぶ1ブロックだった)。
        VStack(alignment: .leading, spacing: 8) {
            Text("チャット")
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.pttMuted)

            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(chat.messages) { message in
                        chatMessageRow(message)
                    }
                }
            }
            // [モバイルUI再編・2026-08-04] Chat専用タブになったため、以前の180pt上限を撤廃し
            // タブの縦幅いっぱいまでメッセージ一覧を表示する(入力欄はVStack末尾に残る)。
            .frame(maxHeight: .infinity)
            .background(.pttPanel.opacity(0.4))

            if let errorMessage = chat.errorMessage {
                Text(errorMessage)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.pttDanger)
            }

            if let pendingFileName = chatPendingAttachmentFileName {
                HStack(spacing: 8) {
                    Text("📎")
                    Text(pendingFileName)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(.pttMuted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer()
                    Button("送信") { sendPendingChatAttachment() }
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundColor(.pttAccent)
                    Button("キャンセル") { cancelPendingChatAttachment() }
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundColor(.pttMuted)
                }
                .padding(8)
                .background(.pttPanel.opacity(0.6))
            } else {
                HStack(spacing: 8) {
                    Menu {
                        Button("写真・動画を選択") { showChatPhotoPicker = true }
                        Button("PDFを選択") { showChatFileImporter = true }
                    } label: {
                        Text("📎")
                            .font(.system(size: 16))
                            .frame(width: 32, height: 32)
                            .background(.pttPanel.opacity(0.6))
                    }

                    TextField("メッセージを入力", text: $chatInputText)
                        .font(.system(size: 14, design: .monospaced))
                        .padding(8)
                        .background(.pttPanel.opacity(0.6))
                        .onSubmit { sendChatMessage() }

                    Button("送信") { sendChatMessage() }
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundColor(.pttAccent)
                        .disabled(chatInputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .padding(14)
        .frame(maxHeight: .infinity)
        .photosPicker(
            isPresented: $showChatPhotoPicker,
            selection: $chatPhotoPickerItem,
            matching: .any(of: [.images, .videos])
        )
        .onChange(of: chatPhotoPickerItem) { _, newItem in
            loadPickedChatPhoto(newItem)
        }
        .fileImporter(
            isPresented: $showChatFileImporter,
            allowedContentTypes: [.pdf]
        ) { result in
            handlePickedChatFile(result)
        }
    }

    private func sendChatMessage() {
        let text = chatInputText
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let roomId = activeRoomId else { return }
        chatInputText = ""
        Task {
            do {
                let idToken = try await auth.fetchIDToken()
                try await chat.sendMessage(tokenServerURL: tokenServerURL, idToken: idToken, roomId: roomId, text: text)
            } catch {
                // chat.errorMessage に理由がセットされているのでUIには既に反映済み。
                // 失敗時は入力内容を戻し、打ち直させずに再送しやすくする。
                chatInputText = text
            }
        }
    }

    /// [Phase16] チャットメッセージ1件分の表示行。テキストに加えて添付があれば
    /// 画像サムネイル、または動画/PDFのファイル名バッジを表示する。
    private func chatMessageRow(_ message: ChatMessage) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(message.displayName): \(message.text)")
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(
                    message.uid == auth.currentUser?.uid
                        ? .pttLive
                        : .pttText
                )
                .frame(maxWidth: .infinity, alignment: .leading)

            if let attachment = message.attachment, let messageId = message.id {
                chatAttachmentView(attachment: attachment, messageId: messageId)
            }
        }
    }

    /// [Phase16] 添付ファイルの表示。画像はサムネイルを取得して表示、
    /// タップすると`getAttachmentUrl`で発行した本体の署名付きURLをSafariで開く
    /// (Web版がwindow.openで新規タブに開くのと同じ扱い)。
    private func chatAttachmentView(attachment: ChatAttachment, messageId: String) -> some View {
        Button {
            openChatAttachment(messageId: messageId)
        } label: {
            if attachment.kind == .image {
                if let uiImage = chatThumbnailImages[messageId] {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFit()
                        .frame(maxHeight: 120)
                        .cornerRadius(4)
                } else {
                    Text("[読み込み中...]")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(.pttMuted)
                }
            } else {
                HStack(spacing: 6) {
                    Text(attachment.kind == .video ? "🎬" : "📄")
                    Text(attachment.fileName)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(.pttMuted)
                        .lineLimit(1)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(.pttPanel)
                .cornerRadius(4)
            }
        }
        .buttonStyle(.plain)
        .task(id: messageId) {
            guard attachment.kind == .image, chatThumbnailImages[messageId] == nil else { return }
            await loadChatThumbnail(messageId: messageId)
        }
    }

    /// [Phase16] サムネイルの短期署名付きURLを発行し、画像本体をダウンロードして
    /// キャッシュする。失敗時は汎用の「読み込み中」表示のまま残す
    /// (Web版ChatPanel.vueと同じくベストエフォート)。
    private func loadChatThumbnail(messageId: String) async {
        guard let roomId = activeRoomId else { return }
        do {
            let idToken = try await auth.fetchIDToken()
            let urlString = try await chat.getThumbnailURL(
                tokenServerURL: tokenServerURL, idToken: idToken, roomId: roomId, messageId: messageId
            )
            guard let url = URL(string: urlString) else { return }
            let (data, _) = try await URLSession.shared.data(from: url)
            if let image = UIImage(data: data) {
                chatThumbnailImages[messageId] = image
            }
        } catch {
            // 失敗時は汎用表示のままにする(errorMessageは送受信本体のみに使う)
        }
    }

    /// [Phase16] 添付ファイル本体の短期署名付きURLを発行し、外部(Safari等)で開く。
    private func openChatAttachment(messageId: String) {
        guard let roomId = activeRoomId else { return }
        Task {
            do {
                let idToken = try await auth.fetchIDToken()
                let urlString = try await chat.getAttachmentURL(
                    tokenServerURL: tokenServerURL, idToken: idToken, roomId: roomId, messageId: messageId
                )
                if let url = URL(string: urlString) {
                    await UIApplication.shared.open(url)
                }
            } catch {
                // エラーはchat.errorMessage経由で表示される想定
            }
        }
    }

    /// [Phase16] PhotosPickerで写真/動画を選択した直後。すぐには送信せず、
    /// pendingAttachmentとして保持する(Web版のonFileSelectedに相当)。
    private func loadPickedChatPhoto(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            defer { chatPhotoPickerItem = nil }
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else { return }
                let utType = item.supportedContentTypes.first
                let mimeType = utType?.preferredMIMEType ?? "application/octet-stream"
                let ext = utType?.preferredFilenameExtension ?? "dat"
                chatPendingAttachmentData = data
                chatPendingAttachmentFileName = "photo_\(Int(Date().timeIntervalSince1970)).\(ext)"
                chatPendingAttachmentContentType = mimeType
            } catch {
                // 選択キャンセル・読み込み失敗時は何もしない
            }
        }
    }

    /// [Phase16] ファイルアプリからPDFを選択した直後。同じくpendingAttachmentとして保持する。
    private func handlePickedChatFile(_ result: Result<URL, Error>) {
        guard case let .success(url) = result else { return }
        let didAccess = url.startAccessingSecurityScopedResource()
        defer { if didAccess { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return }
        chatPendingAttachmentData = data
        chatPendingAttachmentFileName = url.lastPathComponent
        chatPendingAttachmentContentType = "application/pdf"
    }

    private func sendPendingChatAttachment() {
        guard let data = chatPendingAttachmentData,
              let fileName = chatPendingAttachmentFileName,
              let contentType = chatPendingAttachmentContentType,
              let roomId = activeRoomId else { return }
        chatPendingAttachmentData = nil
        chatPendingAttachmentFileName = nil
        chatPendingAttachmentContentType = nil
        Task {
            do {
                let idToken = try await auth.fetchIDToken()
                try await chat.sendAttachment(
                    tokenServerURL: tokenServerURL, idToken: idToken, roomId: roomId,
                    fileData: data, fileName: fileName, contentType: contentType
                )
            } catch {
                // chat.errorMessage に理由がセットされているのでUIには既に反映済み
            }
        }
    }

    private func cancelPendingChatAttachment() {
        chatPendingAttachmentData = nil
        chatPendingAttachmentFileName = nil
        chatPendingAttachmentContentType = nil
    }

    // MARK: - Log

    private var logSection: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(connection.logLines.suffix(50), id: \.self) { line in
                Text(line)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(.pttMuted)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

#Preview {
    ContentView()
}

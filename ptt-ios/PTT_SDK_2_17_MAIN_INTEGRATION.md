# LiveKit 2.17.0 main統合（2026-10-09）

## 統合範囲

基点202d14ce7e05464e962a4e01dfcd074bde38e4e2。mainとcodex/ptt-sdk-2-17-safetyの検証済み未コミット変更を統合。元の変更と個人用Xcode設定は/private/tmp/ptt-main-integration-backupへ保護。個人用xcuserdataはコミット対象外。

LiveKit exact 2.17.0（f07831a7f06bca9e2fc2e136db591b7b42f16d8d）、WebRTC 150.7871.2、UniFFI 0.1.9。Firebase 12.15.0を維持。公式SDKを利用し内部変更なし。

接続世代・Room所有権・接続Taskキャンセル、PTT開始/解放計測、非同期音声worker、画面press所有権、GestureState正常終了/取消とscene inactive時の停止、停止中開始拒否、停止失敗表示を統合。mute（失敗時は所有Roomの切断確認）後に発話権を解放。Firestoreの排他方式、事前publish方式は変更しない。

## 診断・テストコード

隔離rollback試験のFrameStarved track、失敗注入、ローカルSFUはアプリに含めない。無条件retry、独自sender cleanup、一時unmuteなし。

Debug起動ログは実際のLiveKitSDK.version、アプリversion/build/bundleを出力。評価名、固定base_commit、dirtyラベル、評価ソースパスは削除。Debug SDK/WebRTC loggerは既存診断として維持。PTTの時系列・Room状態ログとテスト用非同期依存入口は維持。入口の通常既定値は実処理で、試験の失敗設定はテストtarget内のみ。

過去の評価手順書は証跡として残す。そこに記載された評価ブランチや2.15.1維持方針は当時の条件であり、現在の依存指定はproject.pbxprojとPackage.resolvedを参照。

## 商用リリース前の残項目

- 最近の通常入室でもFrame watcher timeoutが発生した。SDK更新でtimeout解消を保証しない。
- 2回目押下のbutton_event未記録の報告は原因未確定。再押下のUI/Gesture/受付条件を実機確認する。
- enable中releaseの短い送信区間は実機未再現。RTP統計と2端末の音声を別々に確認する。
- rollback隔離試験はsender detachとSFU track削除を確認したが、実機失敗時の全RTP/音声安全性を保証しない。
- 回線断/復帰、Control Center、取得中/enable中中断、連打、退出再入室の実機回帰。App Check本番設定とCloud Run/Firestore floor ownerの照合。

本統合は開発基準の更新であり商用リリースやデプロイは実施しない。

## mainでの再検証

2026-10-09、Xcodeでmainのprojectを指定してiOS 26.5 Simulator（iPad A16）で全test targetを実行。アプリ/テストビルド成功、Swift Testing 24 tests / 4 suites成功、XCTest UI 10実行成功、失敗0、TEST SUCCEEDED（終了コード0）。起動ログに[PTTBuild] sdk=2.17.0を確認。SDK checkoutは上記公式commitで変更なし。

ログ: /tmp/ptt-main-integration-tests.log
結果bundle: /tmp/ptt-sdk-2-17-build/Logs/Test/Test-ptt-ios-2026.10.09_11-55-00-+0900.xcresult

今回のビルドはDebug/Simulator。main統合後の実機Run、Release Archive/App Store配布は未実施。UI起動試験はPTT実音声安全性の代替ではない。

//
//  PTTAuthManager.swift
//  PTTClient
//
//  [Firebase Auth対応]
//  Web版(ptt-client/public/index.html)と同じFirebaseプロジェクトに対して
//  Googleサインインを行い、token-serverへのリクエストに必要な
//  Firebase ID Tokenを供給する。
//
//  token-server側は全エンドポイントで `Authorization: Bearer <ID Token>` を
//  必須にしているため(routes/token.js の requireFirebaseAuth)、
//  これが無いと /token は401、iOS側には不親切な
//  "NSURLErrorDomain error -1011 (badServerResponse)" としてしか見えない。
//

import Foundation
import UIKit
import Combine
import FirebaseAuth
import GoogleSignIn

@MainActor
final class PTTAuthManager: NSObject, ObservableObject {

    @Published private(set) var currentUser: User?
    @Published private(set) var isSigningIn = false
    @Published private(set) var lastErrorMessage: String?

    private var authStateHandle: AuthStateDidChangeListenerHandle?

    override init() {
        super.init()
        currentUser = Auth.auth().currentUser
        // サインイン状態の変化(サインイン/サインアウト/トークン期限切れによる自動サインアウト等)を監視する
        authStateHandle = Auth.auth().addStateDidChangeListener { [weak self] _, user in
            Task { @MainActor in
                self?.currentUser = user
            }
        }
    }

    deinit {
        if let authStateHandle {
            Auth.auth().removeStateDidChangeListener(authStateHandle)
        }
    }

    var displayName: String? {
        currentUser?.displayName ?? currentUser?.email
    }

    /// Googleサインインを開始する。Web版の signInWithPopup(auth, GoogleAuthProvider) に相当。
    func signInWithGoogle() async {
        lastErrorMessage = nil
        guard let presentingVC = Self.topViewController() else {
            lastErrorMessage = "サインイン画面を表示できませんでした"
            return
        }
        isSigningIn = true
        defer { isSigningIn = false }

        do {
            let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presentingVC)
            guard let idToken = result.user.idToken?.tokenString else {
                lastErrorMessage = "Googleサインインからトークンを取得できませんでした"
                return
            }
            let credential = GoogleAuthProvider.credential(
                withIDToken: idToken,
                accessToken: result.user.accessToken.tokenString
            )
            try await Auth.auth().signIn(with: credential)
        } catch {
            lastErrorMessage = "サインインエラー: \(error.localizedDescription)"
        }
    }

    func signOut() {
        do {
            try Auth.auth().signOut()
            GIDSignIn.sharedInstance.signOut()
        } catch {
            lastErrorMessage = "サインアウトエラー: \(error.localizedDescription)"
        }
    }

    /// token-server呼び出し用の有効なFirebase ID Tokenを取得する。
    /// Firebase SDKが期限切れ間近のトークンを検知して自動的にリフレッシュしてくれるため、
    /// 呼び出し側は毎回これを呼ぶだけでよい(手動でのキャッシュ・更新管理は不要)。
    func fetchIDToken() async throws -> String {
        guard let user = Auth.auth().currentUser else {
            throw NSError(
                domain: "PTTAuthManager",
                code: 401,
                userInfo: [NSLocalizedDescriptionKey: "サインインしていません"]
            )
        }
        return try await user.getIDToken()
    }

    /// GoogleSignInのプレゼンテーションに必要な、現在最前面のUIViewControllerを取得する。
    private static func topViewController() -> UIViewController? {
        guard
            let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene,
            let root = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController
        else {
            return nil
        }
        var top = root
        while let presented = top.presentedViewController {
            top = presented
        }
        return top
    }
}

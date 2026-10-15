import Foundation

extension SottoAppModel {
    var aiConsentScope: String? {
        guard let credentials, let profile = credentials.selectedProfile else { return nil }
        return LearningInkStore.scope(server: credentials.serverURL, profileID: profile.id, activity: "ai-consent-v2")
    }

    var hasAIConsent: Bool {
        guard let scope = aiConsentScope else { return false }
        return credentials?.acceptedAIScopes?.contains(scope) == true
    }

    func acceptAIProcessing() {
        guard var next = credentials, let scope = aiConsentScope else { return }
        var scopes = Set(next.acceptedAIScopes ?? [])
        scopes.insert(scope)
        next.acceptedAIScopes = scopes.sorted()
        do { try persistCredentials(next) }
        catch { report(SottoAPIError.message("Your permission could not be saved on this device. \(error.localizedDescription)")) }
    }
}

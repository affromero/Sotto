import Foundation

extension SottoAppModel {
    var aiConsentScope: String? {
        guard let credentials, let profile = credentials.selectedProfile else { return nil }
        return LearningInkStore.scope(server: credentials.serverURL, profileID: profile.id, activity: "ai-consent-v1")
    }

    var hasAIConsent: Bool {
        guard let scope = aiConsentScope else { return false }
        return acceptedAIScope == scope
    }
}

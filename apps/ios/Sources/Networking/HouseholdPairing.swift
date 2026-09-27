import Foundation

struct HouseholdPairing: Identifiable {
    let id = UUID()
    let client: SottoAPIClient
    let profiles: [SottoProfile]

    static func open(client: SottoAPIClient, password: String) async throws -> HouseholdPairing {
        try await client.enterHousehold(password: password)
        let profiles = try await client.listProfiles()
        guard !profiles.isEmpty else {
            throw SottoAPIError.message("Create a learner profile on your server's web app, then try pairing again.")
        }
        return HouseholdPairing(client: client, profiles: profiles)
    }

    func issuePairing(profileID: String, deviceName: String) async throws -> PairingPayload {
        guard profiles.contains(where: { $0.id == profileID }) else {
            throw SottoAPIError.message("Choose one of this server's learner profiles.")
        }
        try await client.selectHouseholdProfile(profileID)
        let pairing = try await client.requestPairingToken(deviceName: deviceName)
        return PairingPayload(serverURL: client.serverURL, token: pairing.token)
    }
}

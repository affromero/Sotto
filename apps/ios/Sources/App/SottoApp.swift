import SwiftUI

@main
struct SottoApp: App {
    @StateObject private var model = SottoAppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .onOpenURL { url in
                    if PlayInvitation.parse(url.absoluteString) != nil {
                        model.openPlay(invitation: url.absoluteString)
                    } else {
                        model.errorMessage = "That is not a supported Sotto game invitation."
                    }
                }
        }
    }
}

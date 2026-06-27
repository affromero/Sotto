import SwiftUI

@main
struct SottoiPadApp: App {
    @StateObject private var model = SottoAppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
        }
    }
}

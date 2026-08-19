import SwiftUI

@main
struct SottoApp: App {
    @StateObject private var model = SottoAppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
        }
    }
}

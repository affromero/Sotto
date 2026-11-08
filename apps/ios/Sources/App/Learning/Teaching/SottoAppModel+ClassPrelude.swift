import Foundation

struct ClassPreludeNavigation: Identifiable, Equatable {
    enum Destination: Equatable { case lesson, pencil, pdf }
    let id: UUID
    let classId: String
    let credentials: SottoCredentials
    let destination: Destination
}

extension SottoAppModel {
    func beginClassPrelude(_ classId: String, destination: ClassPreludeNavigation.Destination = .lesson) {
        guard let credentials, credentials.selectedProfile != nil else { return }
        errorMessage = nil
        classPreludeNavigation = ClassPreludeNavigation(id: UUID(), classId: classId,
            credentials: credentials, destination: destination)
    }

    func isCurrentClassPrelude(_ navigation: ClassPreludeNavigation) -> Bool {
        classPreludeNavigation == navigation && credentials == navigation.credentials && !showingPlay
    }

    func cancelClassPrelude(_ navigation: ClassPreludeNavigation) {
        guard isCurrentClassPrelude(navigation) else { return }
        classPreludeNavigation = nil
        if selectedClass?.id == navigation.classId { closeClass() }
        isLoading = false
        loadingOperation = nil
    }

    func suspendClassPrelude(_ navigation: ClassPreludeNavigation) {
        guard isCurrentClassPrelude(navigation) else { return }
        isLoading = false
        loadingOperation = nil
    }

    func finishClassPrelude(_ navigation: ClassPreludeNavigation) async {
        guard !Task.isCancelled, isCurrentClassPrelude(navigation) else { return }
        if navigation.destination == .pdf {
            await openWorkbookPDF(for: navigation.classId, navigationId: navigation.id)
        } else {
            await openClass(navigation.classId, navigationId: navigation.id)
            guard !Task.isCancelled, isCurrentClassPrelude(navigation) else { return }
            if selectedClass?.id == navigation.classId, navigation.destination == .pencil {
                pencilWorkbook = true
            }
        }
        guard !Task.isCancelled, isCurrentClassPrelude(navigation) else { return }
        if errorMessage == nil && (selectedClass?.id == navigation.classId || (navigation.destination == .pdf && workbook != nil)) {
            classPreludeNavigation = nil
        }
    }
}

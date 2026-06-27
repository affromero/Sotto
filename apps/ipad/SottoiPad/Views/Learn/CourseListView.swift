import SwiftUI

struct CourseListView: View {
    @EnvironmentObject private var model: SottoAppModel
    @State private var selectedCourseId: String?
    @State private var showingNewCourse = false

    private var selectedCourse: SottoCourse? {
        model.courses.first { $0.id == selectedCourseId } ?? model.courses.first
    }

    var body: some View {
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Sotto")
                            .font(.largeTitle.bold())
                            .foregroundStyle(SottoTheme.ink)
                        Text(model.credentials?.serverURL.host() ?? "Self-hosted")
                            .font(.caption.monospaced())
                            .foregroundStyle(SottoTheme.muted)
                            .lineLimit(1)
                    }

                    Spacer()

                    Button {
                        showingNewCourse = true
                    } label: {
                        Image(systemName: "plus")
                            .frame(width: 42, height: 42)
                    }
                    .buttonStyle(.plain)
                    .background(SottoTheme.surface)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(SottoTheme.line))
                    .accessibilityLabel("Create course")
                }
                .padding(.horizontal, 20)
                .padding(.top, 18)

                List(selection: $selectedCourseId) {
                    ForEach(model.courses) { course in
                        CourseRow(course: course)
                            .tag(course.id)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)

                Button(role: .destructive) {
                    model.signOut()
                } label: {
                    Label("Unpair iPad", systemImage: "rectangle.portrait.and.arrow.right")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(SottoSecondaryButtonStyle())
                .padding(20)
            }
            .background(SottoTheme.paper)
            .navigationSplitViewColumnWidth(min: 320, ideal: 380, max: 440)
        } detail: {
            if let selectedCourse {
                CourseDetailPane(course: selectedCourse)
            } else {
                EmptyCourseState {
                    showingNewCourse = true
                }
            }
        }
        .task {
            if model.courses.isEmpty {
                await model.loadCourses()
            }
        }
        .onChange(of: model.courses) { _, courses in
            guard selectedCourseId == nil else { return }
            selectedCourseId = courses.first?.id
        }
        .sheet(isPresented: $showingNewCourse) {
            NewCourseView()
                .environmentObject(model)
        }
    }
}

private struct CourseRow: View {
    let course: SottoCourse

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(course.curriculum?.title ?? "\(course.nativeLang.uppercased()) to \(course.targetLang.uppercased())")
                    .font(.headline)
                    .foregroundStyle(SottoTheme.ink)
                    .lineLimit(2)
                Spacer()
                Text(course.currentLevel)
                    .font(.caption.bold())
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(SottoTheme.primary.opacity(0.12))
                    .foregroundStyle(SottoTheme.primary)
                    .clipShape(Capsule())
            }

            HStack(spacing: 8) {
                Label(course.activeClassId == nil ? "Ready" : "Class open", systemImage: course.activeClassId == nil ? "checkmark.circle" : "bolt.circle")
                    .foregroundStyle(course.activeClassId == nil ? SottoTheme.success : SottoTheme.primary)
                Text("\(course.nativeLang.uppercased()) -> \(course.targetLang.uppercased())")
                    .foregroundStyle(SottoTheme.muted)
            }
            .font(.caption)
        }
        .padding(.vertical, 12)
    }
}

private struct CourseDetailPane: View {
    @EnvironmentObject private var model: SottoAppModel
    let course: SottoCourse

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 10) {
                    Text(course.curriculum?.title ?? "Course")
                        .font(.system(size: 48, weight: .bold, design: .serif))
                        .foregroundStyle(SottoTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)

                    HStack(spacing: 12) {
                        StatPill(title: "From", value: course.nativeLang.uppercased())
                        StatPill(title: "To", value: course.targetLang.uppercased())
                        StatPill(title: "Level", value: course.currentLevel)
                        StatPill(title: "Placement", value: course.placementSource)
                    }
                }

                HStack(spacing: 14) {
                    Button {
                        Task {
                            if let activeClassId = course.activeClassId {
                                await model.openClass(activeClassId)
                            } else {
                                await model.startOrResumeClass(for: course)
                            }
                        }
                    } label: {
                        Label(course.activeClassId == nil ? "Take class" : "Resume class", systemImage: "play.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(SottoPrimaryButtonStyle())

                    Button {
                        Task {
                            await model.startFullCatchUp(for: course)
                        }
                    } label: {
                        Label("Full catch-up", systemImage: "arrow.triangle.2.circlepath")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(SottoSecondaryButtonStyle())

                    Button {
                        Task {
                            await model.openWorkbook(for: course)
                        }
                    } label: {
                        Label("Workbook", systemImage: "pencil.and.scribble")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(SottoSecondaryButtonStyle())
                }

                VStack(alignment: .leading, spacing: 14) {
                    Text(course.activeClassId == nil ? "Next class is ready" : "Current class is waiting")
                        .font(.title2.bold())
                        .foregroundStyle(SottoTheme.ink)
                    Text(course.activeClassId == nil ? "Use Take class to generate the first class. The workbook becomes available as soon as that class exists." : "Resume the active class before Sotto creates another one. The workbook button opens the current worksheet with Apple Pencil notes.")
                        .font(.body)
                        .foregroundStyle(SottoTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(22)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(SottoTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(SottoTheme.line)
                )
            }
            .padding(44)
            .frame(maxWidth: 980, alignment: .leading)
        }
        .background(SottoTheme.paper)
    }
}

private struct EmptyCourseState: View {
    let onCreate: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "books.vertical")
                .font(.system(size: 62))
                .foregroundStyle(SottoTheme.primary)
            Text("Create your first course")
                .font(.largeTitle.bold())
                .foregroundStyle(SottoTheme.ink)
            Text("Choose the native and target language codes. Sotto will create the curriculum on your self-hosted server.")
                .font(.title3)
                .multilineTextAlignment(.center)
                .foregroundStyle(SottoTheme.muted)
                .frame(maxWidth: 520)
            Button {
                onCreate()
            } label: {
                Label("Create course", systemImage: "plus")
            }
            .buttonStyle(SottoPrimaryButtonStyle())
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(SottoTheme.paper)
    }
}

private struct StatPill: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title.uppercased())
                .font(.caption2.bold())
                .foregroundStyle(SottoTheme.muted)
            Text(value)
                .font(.headline)
                .foregroundStyle(SottoTheme.ink)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }
}

private struct NewCourseView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.dismiss) private var dismiss
    @State private var native = "en"
    @State private var target = "es"

    var body: some View {
        NavigationStack {
            Form {
                Section("Languages") {
                    TextField("Native language", text: $native)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Target language", text: $target)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
            }
            .navigationTitle("New course")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        Task {
                            await model.createCourse(native: native, target: target)
                            if model.errorMessage == nil {
                                dismiss()
                            }
                        }
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

// RecorderDemo: a small SwiftUI host for the vitrinka journey recorder.
//
// It has a main window, a Settings window, a sheet, buttons, a text field, a
// SecureField (private automatically) and a panel marked private, so a live
// run produces a journey with branches, notes and masked regions.
// packages/macos/README.md has the run commands.

import AppKit
import OSLog
import SwiftUI
import VitrinkaRecorder

@main
struct RecorderDemoApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup("Recorder demo", id: "main") {
            ContentView()
                .frame(minWidth: 560, minHeight: 460)
        }
        Settings {
            SettingsView()
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // A bare SwiftPM executable starts as a background process.
        NSApp.setActivationPolicy(.regular)
        NSApp.activate()
        #if DEBUG
        // Debug only, and only when VITRINKA_RECORDER_URL (or the user
        // default VitrinkaRecorderURL) names a vitrinka server.
        // The console lane takes error and fault entries of the app's own
        // subsystem (DemoLog.subsystem equals the app id) by default.
        if let config = VitrinkaRecorderConfiguration.fromEnvironment(appID: "dev.vitrinka.recorder-demo") {
            VitrinkaRecorder.configure(config)
        }
        #endif
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

enum DemoLog {
    static let subsystem = "dev.vitrinka.recorder-demo"
    static let logger = Logger(subsystem: subsystem, category: "demo")
}

struct Item: Identifiable, Hashable {
    let id = UUID()
    var name: String
    var done = false
}

struct ContentView: View {
    @State private var items: [Item] = [Item(name: "Calibrate fan curve"), Item(name: "Export report")]
    @State private var newName = ""
    @State private var password = ""
    @State private var selection: Item.ID?
    @State private var showDetails = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                TextField("New item", text: $newName)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel("New item name")
                    .onSubmit(add)
                Button("Add item", action: add)
                    .accessibilityIdentifier("add-item")
                    .keyboardShortcut("n", modifiers: [.command, .shift])
            }

            List(selection: $selection) {
                ForEach($items) { $item in
                    Toggle(item.name, isOn: $item.done)
                        .tag(item.id)
                }
            }
            .frame(minHeight: 140)
            .vitrinkaRoute("items")

            HStack {
                Button("Show details") { showDetails = true }
                    .disabled(selection == nil)
                    .accessibilityIdentifier("show-details")
                Button("Delete", role: .destructive) {
                    items.removeAll { $0.id == selection }
                    selection = nil
                }
                .disabled(selection == nil)
                Spacer()
                SettingsLink { Text("Open settings") }
            }

            GroupBox("Account") {
                VStack(alignment: .leading, spacing: 8) {
                    SecureField("API password", text: $password)
                        .textFieldStyle(.roundedBorder)
                    Text("The password field is private: keyframes show it black.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(4)
            }

            GroupBox("Private panel") {
                Text("Customer: Jana Nováková · IBAN CZ65 0800 0000 1920 0014 5399")
                    .padding(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .vitrinkaPrivate()
            }

            HStack {
                Button("Log an error") {
                    DemoLog.logger.error("demo: payment API answered 502 for order \(Int.random(in: 1000 ... 9999), privacy: .public)")
                }
                Button("Mark this moment") {
                    VitrinkaRecorder.mark("Marked from the demo")
                }
                Spacer()
                Text("⌥⇧N note · ⌥⇧A annotate · ⌥⇧P pause · ⌥⇧S stop")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(18)
        .sheet(isPresented: $showDetails) {
            DetailsSheet(item: items.first { $0.id == selection }, close: { showDetails = false }, approve: approve)
        }
    }

    private func add() {
        let name = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        items.append(Item(name: name))
        newName = ""
    }

    private func approve() {
        if let i = items.firstIndex(where: { $0.id == selection }) { items[i].done = true }
        showDetails = false
    }
}

struct DetailsSheet: View {
    let item: Item?
    let close: () -> Void
    let approve: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(item?.name ?? "No item").font(.title2.weight(.semibold))
            Text(item?.done == true ? "Done" : "Open").foregroundStyle(.secondary)
            HStack {
                Spacer()
                Button("Close", action: close).keyboardShortcut(.cancelAction)
                Button("Approve", action: approve)
                    .keyboardShortcut(.defaultAction)
                    .accessibilityIdentifier("approve")
            }
        }
        .padding(20)
        .frame(width: 360)
        .vitrinkaRoute("details")
    }
}

struct SettingsView: View {
    @AppStorage("demo.refresh") private var refresh = 30.0
    @AppStorage("demo.theme") private var theme = "system"
    @AppStorage("demo.notifications") private var notifications = true
    @State private var server = "https://example.invalid"

    var body: some View {
        Form {
            Toggle("Notifications", isOn: $notifications)
            Picker("Theme", selection: $theme) {
                Text("System").tag("system")
                Text("Light").tag("light")
                Text("Dark").tag("dark")
            }
            Slider(value: $refresh, in: 5 ... 120, step: 5) { Text("Refresh (\(Int(refresh)) s)") }
            TextField("Server", text: $server)
        }
        .padding(20)
        .frame(width: 420)
        .vitrinkaRoute("general")
    }
}

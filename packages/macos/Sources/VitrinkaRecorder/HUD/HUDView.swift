#if DEBUG
import SwiftUI

/// The recorder HUD: a small floating capsule.
///
/// Idle: a hollow ring when this Mac is not linked, a dot when it is, then
/// Link or Record. Recording: a red dot, the clock, the frame count and the
/// sync state, then pause, note, mark, annotate and stop. After stop: Saved
/// with Open board.
struct HUDView: View {
    @ObservedObject var model: HUDModel
    @FocusState private var noteFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                switch model.phase {
                case .idle: idle
                case .linking: linking
                case .starting: progress("Starting…")
                case .recording: recording
                case .stopping: progress("Saving…")
                case .saved: saved
                }
            }
            if model.noteOpen { noteField }
            if let message = model.message {
                Text(message)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                    .frame(maxWidth: 360, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.separator, lineWidth: 0.5))
        .fixedSize()
    }

    private var idle: some View {
        Group {
            Image(systemName: model.linked ? "circle.fill" : "circle")
                .foregroundStyle(model.linked ? Color.accentColor : Color.secondary)
                .help(model.linked ? "Ready to record" : "Not linked")
            Text("vitrinka").font(.callout.weight(.semibold))
            if model.linked {
                Button("Record", action: model.onStart)
                    .keyboardShortcut(.defaultAction)
                    .help("Start a recording")
                if model.linkedByDevice {
                    Button("Unlink", action: model.onUnlink)
                        .buttonStyle(.borderless)
                        .font(.caption)
                        .help("Forget this Mac's vitrinka link")
                }
            } else {
                Button("Link this Mac", action: model.onLink)
                    .help("Link this Mac to vitrinka with a short code")
            }
        }
    }

    private var linking: some View {
        Group {
            Image(systemName: "link")
            Text(model.userCode ?? "…").font(.system(.body, design: .monospaced).weight(.semibold))
            if let url = model.verifyURL {
                Button("Open vitrinka") { model.onOpenURL(url) }
            }
            Button("Cancel", action: model.onCancelLink).buttonStyle(.borderless)
        }
    }

    private var recording: some View {
        Group {
            Circle()
                .fill(model.paused ? Color.orange : Color.red)
                .frame(width: 9, height: 9)
                .help(model.paused ? "Paused" : "Recording")
            Text(model.clock).font(.system(.body, design: .monospaced))
            Text("\(model.frames) frames").font(.caption).foregroundStyle(.secondary)
            syncBadge
            Divider().frame(height: 16)
            if model.recovered {
                Text("Recovered").font(.caption).foregroundStyle(.secondary)
            }
            iconButton(model.paused ? "play.fill" : "pause.fill", model.paused ? "Resume (⌥⇧P)" : "Pause (⌥⇧P)", model.onTogglePause)
            iconButton("square.and.pencil", "Note (⌥⇧N)", model.openNote)
                .disabled(model.paused)
            iconButton("flag", "Mark this moment", model.onMark)
                .disabled(model.paused)
            iconButton("viewfinder", "Annotate a region (⌥⇧A)", model.onAnnotate)
                .disabled(model.paused)
            iconButton("stop.fill", "Stop and save (⌥⇧S)", model.onStop)
        }
    }

    private var syncBadge: some View {
        let (symbol, color, help): (String, Color, String) = {
            switch model.sync {
            case .ok: return ("checkmark.icloud", .secondary, "Synced")
            case .backlog: return ("icloud.and.arrow.up", .orange, "\(model.queued) waiting to upload")
            case .offline: return ("icloud.slash", .orange, "Offline — \(model.queued) kept on this Mac")
            case .dead: return ("exclamationmark.icloud", .red, "The server ended this session")
            }
        }()
        return Image(systemName: symbol).foregroundStyle(color).help(help)
    }

    private var saved: some View {
        Group {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
            Text("Saved").font(.callout.weight(.semibold))
            if let url = model.boardURL {
                Button("Open board") { model.onOpenURL(url) }
                    .keyboardShortcut(.defaultAction)
            } else if let id = model.savedSessionID {
                Text("session \(id)").font(.caption).foregroundStyle(.secondary)
            }
            Button("Done", action: model.onDismissSaved).buttonStyle(.borderless)
        }
    }

    private var noteField: some View {
        HStack(spacing: 6) {
            TextField("Note on this screen", text: $model.noteText)
                .textFieldStyle(.roundedBorder)
                .frame(width: 260)
                .focused($noteFocused)
                .onSubmit { model.submitNote() }
                .onExitCommand { model.cancelNote() }
                .onAppear { noteFocused = true }
            Button("Add") { model.submitNote() }
            Button("Cancel") { model.cancelNote() }.buttonStyle(.borderless)
        }
    }

    private func progress(_ label: String) -> some View {
        Group {
            ProgressView().controlSize(.small)
            Text(label).font(.callout)
        }
    }

    private func iconButton(_ symbol: String, _ help: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: symbol).frame(width: 18, height: 18) }
            .buttonStyle(.borderless)
            .help(help)
    }
}
#endif

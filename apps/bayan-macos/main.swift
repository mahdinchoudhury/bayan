import AppKit
import WebKit

// Mac-only host. WebKit supplies CoreText Arabic shaping, bidi and accessibility.
// The source app's verse-popup study model is preserved in Web/app.js.
final class BayanHost: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    let home = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Bayan", isDirectory: true)
    func applicationDidFinishLaunching(_ notification: Notification) {
        do { try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true) }
        catch { fatalError("Cannot open Bayan storage: \(error.localizedDescription)") }
        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(self, name: "bayan")
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1240, height: 850), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = "Bayan"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.toolbarStyle = .unifiedCompact
        let toolbar = NSToolbar(identifier: "BayanToolbar")
        window.toolbar = toolbar
        window.minSize = NSSize(width: 900, height: 640)
        window.contentView = web
        window.center()
        window.makeKeyAndOrderFront(nil)
        let menu = NSMenu()
        let appItem = NSMenuItem()
        menu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Bayan", action: #selector(about), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Bayan", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        let edit = NSMenu(title: "Edit")
        for (title, selector, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: NSSelectorFromString(selector), keyEquivalent: key)
        }
        editItem.submenu = edit
        menu.addItem(editItem)
        NSApp.mainMenu = menu
        let page = Bundle.main.resourceURL!.appendingPathComponent("Web/index.html")
        web.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
        NSApp.activate(ignoringOtherApps: true)
    }
    @objc func about() { NSApp.orderFrontStandardAboutPanel(options: [.applicationName: "Bayan", .applicationVersion: "0.1 Preview", .credits: NSAttributedString(string: "A Quran reader for Mac. Based on michaelshimeles/bible-rs (MIT). Content provided by Quran Foundation when connected.")]) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func reply(_ id: Int, value: Any? = nil, error: String? = nil) {
        var message: [String: Any] = ["id": id]
        message["value"] = value ?? NSNull()
        if let error { message["error"] = error }
        guard let data = try? JSONSerialization.data(withJSONObject: message), let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { self.web.evaluateJavaScript("window.nativeReply(\(json))", completionHandler: nil) }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let body = message.body as? [String: Any], let id = body["id"] as? Int, let op = body["op"] as? String else { return }
        do {
            switch op {
            case "load":
                let file = home.appendingPathComponent("library.json")
                reply(id, value: FileManager.default.fileExists(atPath: file.path) ? try JSONSerialization.jsonObject(with: Data(contentsOf: file)) : [:])
            case "save":
                guard let value = body["value"], JSONSerialization.isValidJSONObject(value) else { throw HostError.message("Invalid library") }
                let data = try JSONSerialization.data(withJSONObject: value)
                try data.write(to: home.appendingPathComponent("library.json"), options: .atomic)
                reply(id, value: true)
            case "request":
                guard let raw = body["url"] as? String, let url = URL(string: raw), Self.allowed(url) else { throw HostError.message("Use an HTTPS service address, or localhost for development.") }
                var request = URLRequest(url: url, timeoutInterval: 45)
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                URLSession.shared.dataTask(with: request) { data, response, error in
                    if let error { self.reply(id, error: error.localizedDescription); return }
                    guard let http = response as? HTTPURLResponse, let data else { self.reply(id, error: "No response from the content service."); return }
                    let value = try? JSONSerialization.jsonObject(with: data)
                    guard (200..<300).contains(http.statusCode) else {
                        self.reply(id, error: (value as? [String: Any])?["error"] as? String ?? "Content service returned \(http.statusCode)."); return
                    }
                    self.reply(id, value: value)
                }.resume()
            case "export":
                let panel = NSSavePanel()
                panel.nameFieldStringValue = body["name"] as? String ?? "Bayan-notes.json"
                if panel.runModal() == .OK, let url = panel.url, let text = body["text"] as? String {
                    try text.write(to: url, atomically: true, encoding: .utf8)
                    reply(id, value: true)
                } else { reply(id, value: false) }
            case "import":
                let panel = NSOpenPanel()
                panel.allowsMultipleSelection = false
                if panel.runModal() == .OK, let url = panel.url {
                    reply(id, value: try JSONSerialization.jsonObject(with: Data(contentsOf: url)))
                } else { reply(id) }
            case "openAccess":
                NSWorkspace.shared.open(URL(string: "https://dev-console.quran.foundation")!)
                reply(id, value: true)
            default: throw HostError.message("Unknown action")
            }
        } catch { reply(id, error: error.localizedDescription) }
    }
    static func allowed(_ url: URL) -> Bool {
        url.scheme == "https" || (url.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(url.host ?? ""))
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.request.url?.isFileURL == true ? .allow : .cancel)
    }
}
enum HostError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let message) = self { return message }; return nil }
}
let app = NSApplication.shared
let delegate = BayanHost()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()

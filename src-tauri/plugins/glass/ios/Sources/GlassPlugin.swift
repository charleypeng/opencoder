// TASK-M7-02 spike: iOS 26 Liquid Glass validation.
//
// Purpose: prove that a native UITabBar can be injected into the Tauri
// WKWebView context on the iOS 26 simulator, and that events can round-trip
// web <-> native. The spike concluded PASS (tier A enabled, docs/tasks/
// M7.md appendix); the bar is now the production bottom navigation of the
// mobile shell. The tab titles are English until M9 i18n localizes them.
//
// Bridge contract used by the mobile shell (src/shells/mobile/glass.ts):
//   native -> web: window.__glassTabSelected(index) / window.__glassNativePing(msg)
//   web -> native: window.webkit.messageHandlers.glassBridge.postMessage({
//                  type: "setActive", index: N } | { type: "ping" })

import Foundation
import SwiftRs
import Tauri
import UIKit
import WebKit

class GlassPlugin: Plugin, UITabBarDelegate, WKScriptMessageHandler {
  private var webview: WKWebView?
  private var tabBar: UITabBar?

  @objc override func load(webview: WKWebView) {
    self.webview = webview
    webview.configuration.userContentController.add(self, name: "glassBridge")
    DispatchQueue.main.async {
      self.injectTabBar()
    }
  }

  // MARK: - Native UITabBar (iOS 26 SDK -> automatic Liquid Glass material)

  private func injectTabBar() {
    guard let view = manager.viewController?.view, tabBar == nil else { return }

    let bar = UITabBar()
    bar.delegate = self
    bar.translatesAutoresizingMaskIntoConstraints = false

    let items = [
      UITabBarItem(title: "Sessions", image: UIImage(systemName: "message"), tag: 0),
      UITabBarItem(title: "Files", image: UIImage(systemName: "folder"), tag: 1),
      UITabBarItem(title: "Terminal", image: UIImage(systemName: "terminal"), tag: 2),
      UITabBarItem(title: "Settings", image: UIImage(systemName: "gearshape"), tag: 3),
    ]
    bar.setItems(items, animated: false)
    bar.selectedItem = items.first

    view.addSubview(bar)
    view.bringSubviewToFront(bar)
    NSLayoutConstraint.activate([
      bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      bar.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])

    tabBar = bar
    NSLog("[glass] tab bar injected, %d items", items.count)
  }

  // MARK: - Native -> web

  private func notifyTabSelected(_ index: Int) {
    let script = "typeof window.__glassTabSelected === 'function' && window.__glassTabSelected(\(index))"
    NSLog("[glass] tabSelected -> web: %d", index)
    webview?.evaluateJavaScript(script) { _, error in
      if let error = error {
        NSLog("[glass] evaluateJavaScript error: %@", error.localizedDescription)
      }
    }
  }

  private func notifyPing(_ message: String) {
    let js = String(format: "typeof window.__glassNativePing === 'function' && window.__glassNativePing('%@')", message)
    NSLog("[glass] nativePing -> web: %@", message)
    webview?.evaluateJavaScript(js) { _, error in
      if let error = error {
        NSLog("[glass] evaluateJavaScript error: %@", error.localizedDescription)
      }
    }
  }

  // MARK: - UITabBarDelegate

  func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
    guard let index = tabBar.items?.firstIndex(of: item) else { return }
    notifyTabSelected(index)
  }

  // MARK: - WKScriptMessageHandler (web -> native)

  func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    guard message.name == "glassBridge", let body = message.body as? [String: Any] else { return }
    NSLog("[glass] message from web: %@", body)

    guard let type = body["type"] as? String else { return }
    switch type {
    case "setActive":
      if let index = body["index"] as? Int, let items = tabBar?.items, items.indices.contains(index) {
        tabBar?.selectedItem = items[index]
        // Programmatic selection does not reliably fire tabBar(_:didSelect:),
        // so notify the web side explicitly to complete the round trip.
        notifyTabSelected(index)
      }
    case "ping":
      notifyPing("pong")
    default:
      break
    }
  }
}

@_cdecl("init_plugin_glass")
func initPlugin() -> Plugin {
  return GlassPlugin()
}

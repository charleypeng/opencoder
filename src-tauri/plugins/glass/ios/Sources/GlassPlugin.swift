// TASK-M7-02 spike: iOS 26 Liquid Glass validation.
//
// Purpose: prove that a native UITabBar can be injected into the Tauri
// WKWebView context on the iOS 26 simulator, and that events can round-trip
// web <-> native. This is a spike; the real tab bar / contract (setItems,
// setActive, setHidden, badge, tabSelected events) lands with M7-03.
//
// Bridge contract used by the demo (src/shells/mobile/MobileShell.tsx):
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
      UITabBarItem(title: "会话", image: UIImage(systemName: "message"), tag: 0),
      UITabBarItem(title: "文件", image: UIImage(systemName: "folder"), tag: 1),
      UITabBarItem(title: "终端", image: UIImage(systemName: "terminal"), tag: 2),
      UITabBarItem(title: "设置", image: UIImage(systemName: "gearshape"), tag: 3),
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

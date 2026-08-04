// swift-tools-version:5.3
// TASK-M7-02 spike: minimal Swift package for the glass plugin.

import PackageDescription

let package = Package(
  name: "tauri-plugin-glass",
  platforms: [
    .iOS(.v13),
  ],
  products: [
    .library(
      name: "tauri-plugin-glass",
      type: .static,
      targets: ["tauri-plugin-glass"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-glass",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)

// TASK-M7-02 spike: declares the iOS Swift sources directory so tauri-build
// compiles and links ios/Sources/GlassPlugin.swift into the iOS app binary.
fn main() {
    tauri_plugin::Builder::new(&[]).ios_path("ios").build();
}

# Lua formatter source

Moyu distributes the unmodified dprint-plugin-stylua 0.2.1 WebAssembly plugin
from https://plugins.dprint.dev/RubixDev/stylua-v0.2.1.wasm.
The adjacent receipt pins that binary's SHA-256 and size.

This directory provides the original published Rust source archives for
dprint-plugin-stylua 0.2.1 (GPL-3.0-only) and StyLua 0.15.2 (MPL-2.0), including
their manifests and license texts. manifest.json records their original URLs
and SHA-256 hashes. No changes were made to either source or binary.

To build the plugin with Rust/Cargo and the wasm32-unknown-unknown target:

```sh
tar -xf dprint-plugin-stylua-0.2.1.crate
cd dprint-plugin-stylua-0.2.1
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown
```

The original Cargo.toml includes default Lua 5.2, 5.3, 5.4 and Luau features.
Cargo resolves the public Rust dependency versions declared by that manifest.
The upstream project is https://github.com/RubixDev/dprint-plugin-stylua/tree/v0.2.1.
The StyLua source is https://github.com/JohnnyMorganz/StyLua/tree/v0.15.2.
Building from current registry dependency resolutions is not claimed to
reproduce the historical upstream binary byte-for-byte. Moyu builds use the
checked, pinned binary and never download formatters at runtime.

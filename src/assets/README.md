# Assets Directory

This directory contains app icons and other bundled assets for Typefree.

## Required Icons

For proper Tauri packaging, keep the following icon files in sync:

- `icon.icns` - macOS icon (1024x1024 recommended)
- `icon.ico` - Windows icon (256x256 recommended)
- `icon.png` - Linux icon (512x512 recommended)

## Icon Specifications

- **macOS (.icns)**: 1024x1024 pixels, PNG format converted to ICNS
- **Windows (.ico)**: 256x256 pixels, PNG format converted to ICO
- **Linux (.png)**: 512x512 pixels, PNG format

## Creating Icons

You can create these icons using:

- Online converters like https://convertio.co/
- Design tools like Figma, Sketch, or Photoshop
- Command line tools like ImageMagick

## Placeholder

During development, missing icons may fall back to defaults, but release builds should always use the project icons in this directory.

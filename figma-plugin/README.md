# IPODhan Design System Figma Plugin

## Installation Guide

### Prerequisites
- Figma Desktop App (required for local plugin development)
- Node.js installed on your system
- Basic familiarity with Figma plugins

### Quick Installation Steps

#### Step 1: Plugin Files Ready ✅

The plugin files have been compiled and are ready to use:
- ✅ `code.js` - Compiled JavaScript (ready)
- ✅ `manifest.json` - Plugin configuration
- ✅ `ui.html` - Plugin interface

#### Step 2: Install in Figma

1. **Open Figma Desktop App**

2. **Access Plugin Development**
   - Click on your profile icon (top-left)
   - Select `Plugins` → `Development` → `Import plugin from manifest...`

3. **Select the Manifest File**
   - Navigate to `figma-plugin` folder
   - Select `manifest.json`
   - Click `Open`

4. **Plugin is Now Installed!**
   - The plugin appears in your development plugins list
   - Name: "IPODhan Design System Generator"

### Using the Plugin

#### Running the Plugin

1. **Open Any Figma File**
   - Create a new file or open existing one
   - Recommended: Start with a blank file

2. **Launch the Plugin**
   - Right-click on canvas → `Plugins` → `Development` → `IPODhan Design System Generator`
   - Or use keyboard shortcut: `Cmd/Ctrl + Option/Alt + P` → Search for "IPODhan"

3. **Plugin Interface Opens**
   - You'll see the plugin UI with options

#### Plugin Features

**🚀 Generate Everything** - One-click to create complete design system
- All color styles (40+ colors)
- All typography styles (20+ text styles)
- Shadow effects (6 levels)
- Component library

**Individual Generators:**
- 🎨 **Color Styles** - Creates primary, semantic, and neutral colors
- 📝 **Typography** - Creates heading, body, and label text styles
- 🌑 **Shadows** - Creates elevation shadow effects
- 📦 **Components** - Creates Button, Input, Card, Badge, IPO Card components

### What Gets Generated

#### Color Styles (Local Styles Panel)
```
Primary/
  ├── Blue/50-900
  ├── Purple/50-900
Semantic/
  ├── Success/Light, Default, Dark
  ├── Warning/Light, Default, Dark
  ├── Danger/Light, Default, Dark
Neutral/
  ├── Gray/50-900
  ├── White
  └── Black
```

#### Typography Styles
```
Display/
  ├── Large (48px)
  ├── Medium (36px)
  └── Small (30px)
Heading/
  ├── H1-H6 (24px-12px)
Body/
  ├── Large (18px)
  ├── Base (16px)
  └── Small (14px)
Labels/
  └── Various sizes
```

#### Components Created
- **Button** - Primary, Secondary, Tertiary variants
- **Input Field** - With label and states
- **Card** - Basic content card
- **Badge** - Status indicators
- **IPO Card** - Complete IPO listing card

### Troubleshooting

#### Plugin Not Loading
- Ensure you're using Figma Desktop App (not web)
- Check if `code.js` exists (compile TypeScript if missing)
- Verify manifest.json is valid JSON

#### TypeScript Compilation Error
```bash
# Install TypeScript globally if needed
npm install -g typescript

# Then compile
tsc code.ts --target ES2017 --module commonjs
```

#### Components Not Appearing
- Check Figma's Assets panel (left sidebar)
- Ensure you have edit permissions on the file
- Try refreshing Figma (Cmd/Ctrl + R)

### Advanced Usage

#### Customizing the Plugin

To modify colors or components:

1. Edit `code.ts`
2. Recompile: `tsc code.ts --target ES2017 --module commonjs`
3. Reload plugin in Figma: `Cmd/Ctrl + Option/Alt + P` → Click reload icon

#### Publishing the Plugin

To share with team:

1. In Figma → `Plugins` → `Publish Plugin`
2. Add icon, description, and screenshots
3. Choose visibility (Organization/Public)
4. Submit for review

### File Structure
```
figma-plugin/
├── manifest.json    # Plugin configuration
├── code.ts         # Source TypeScript code
├── code.js         # Compiled JavaScript (generated)
├── ui.html         # Plugin UI interface
└── README.md       # This file
```

### Tips for Best Results

1. **Start Fresh**: Use on a new Figma file for clean organization
2. **Page Setup**: Create separate pages for Colors, Typography, Components
3. **Team Libraries**: Publish as team library for consistency
4. **Version Control**: Duplicate file before major changes
5. **Documentation**: Add descriptions to styles in Figma

### Support

For issues or customization needs:
- Check the main project documentation in `/docs/`
- Review component specifications in `figma-component-specs.md`
- Modify `code.ts` for custom requirements

---

*Generated design system follows IPODhan brand guidelines and includes all necessary components for web and mobile design.*
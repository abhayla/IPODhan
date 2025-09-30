# IPODhan Figma Design System Guide

## 🎨 Figma File Structure

### Recommended Page Organization
```
📁 IPODhan Design System
├── 📄 1. Cover & Documentation
├── 📄 2. Foundation
│   ├── Colors
│   ├── Typography
│   ├── Grid & Spacing
│   ├── Shadows & Effects
│   └── Icons
├── 📄 3. Components
│   ├── Atoms
│   ├── Molecules
│   ├── Organisms
│   └── Templates
├── 📄 4. Patterns
│   ├── Forms
│   ├── Navigation
│   ├── Data Display
│   └── Feedback
├── 📄 5. Screens
│   ├── Desktop
│   ├── Tablet
│   └── Mobile
└── 📄 6. Prototypes
```

---

## 1. Foundation Setup

### 1.1 Color Styles

#### Create these color styles in Figma:

```yaml
Primary Colors:
  primary/50: #EFF6FF
  primary/100: #DBEAFE
  primary/200: #BFDBFE
  primary/300: #93C5FD
  primary/400: #60A5FA
  primary/500: #3B82F6  # Main Brand Blue
  primary/600: #2563EB
  primary/700: #1D4ED8
  primary/800: #1E40AF
  primary/900: #1E3A8A

Semantic Colors:
  success/light: #D1FAE5
  success/base: #10B981
  success/dark: #059669

  warning/light: #FEF3C7
  warning/base: #F59E0B
  warning/dark: #D97706

  danger/light: #FEE2E2
  danger/base: #EF4444
  danger/dark: #DC2626

  info/light: #DBEAFE
  info/base: #3B82F6
  info/dark: #1D4ED8

Neutral Colors:
  gray/50: #F9FAFB
  gray/100: #F3F4F6
  gray/200: #E5E7EB
  gray/300: #D1D5DB
  gray/400: #9CA3AF
  gray/500: #6B7280
  gray/600: #4B5563
  gray/700: #374151
  gray/800: #1F2937
  gray/900: #111827

Special Colors:
  purple/500: #8B5CF6  # Secondary accent
  purple/600: #7C3AED
  green/500: #10B981   # Profit/Success
  red/500: #EF4444     # Loss/Danger
  yellow/500: #F59E0B  # GMP indicator
  orange/500: #F97316  # Alerts
```

#### How to add in Figma:
1. Select any shape
2. Click on Fill color
3. Click Style icon (four dots)
4. Create new color style
5. Name it using the convention above
6. Organize in groups (Primary/, Semantic/, etc.)

### 1.2 Typography Styles

#### Create these text styles:

```yaml
Display:
  Display/2XL:
    Font: Inter
    Weight: 700 (Bold)
    Size: 72px
    Line Height: 90px (125%)
    Letter Spacing: -2%

  Display/XL:
    Font: Inter
    Weight: 700
    Size: 60px
    Line Height: 72px (120%)
    Letter Spacing: -2%

  Display/Large:
    Font: Inter
    Weight: 700
    Size: 48px
    Line Height: 60px (125%)
    Letter Spacing: -1%

Headings:
  Heading/H1:
    Font: Inter
    Weight: 700
    Size: 36px
    Line Height: 44px (122%)
    Letter Spacing: -0.5%

  Heading/H2:
    Font: Inter
    Weight: 600
    Size: 30px
    Line Height: 38px (127%)
    Letter Spacing: 0

  Heading/H3:
    Font: Inter
    Weight: 600
    Size: 24px
    Line Height: 32px (133%)
    Letter Spacing: 0

  Heading/H4:
    Font: Inter
    Weight: 600
    Size: 20px
    Line Height: 28px (140%)
    Letter Spacing: 0

  Heading/H5:
    Font: Inter
    Weight: 500
    Size: 18px
    Line Height: 26px (144%)
    Letter Spacing: 0

  Heading/H6:
    Font: Inter
    Weight: 500
    Size: 16px
    Line Height: 24px (150%)
    Letter Spacing: 0

Body Text:
  Body/Large:
    Font: Inter
    Weight: 400
    Size: 18px
    Line Height: 28px (156%)
    Letter Spacing: 0

  Body/Base:
    Font: Inter
    Weight: 400
    Size: 16px
    Line Height: 24px (150%)
    Letter Spacing: 0

  Body/Small:
    Font: Inter
    Weight: 400
    Size: 14px
    Line Height: 20px (143%)
    Letter Spacing: 0

  Body/XSmall:
    Font: Inter
    Weight: 400
    Size: 12px
    Line Height: 16px (133%)
    Letter Spacing: 0

Special Text:
  Label/Large:
    Font: Inter
    Weight: 500
    Size: 14px
    Line Height: 20px
    Letter Spacing: 0.5%

  Label/Base:
    Font: Inter
    Weight: 500
    Size: 12px
    Line Height: 16px
    Letter Spacing: 0.5%

  Caption:
    Font: Inter
    Weight: 400
    Size: 12px
    Line Height: 16px
    Letter Spacing: 0

  Button/Large:
    Font: Inter
    Weight: 600
    Size: 16px
    Line Height: 24px
    Letter Spacing: 0.5%

  Button/Base:
    Font: Inter
    Weight: 600
    Size: 14px
    Line Height: 20px
    Letter Spacing: 0.5%

  Button/Small:
    Font: Inter
    Weight: 600
    Size: 12px
    Line Height: 16px
    Letter Spacing: 0.5%
```

### 1.3 Spacing System

#### Create a spacing scale:

```yaml
Spacing Values:
  space-0: 0px
  space-1: 4px
  space-2: 8px
  space-3: 12px
  space-4: 16px
  space-5: 20px
  space-6: 24px
  space-8: 32px
  space-10: 40px
  space-12: 48px
  space-16: 64px
  space-20: 80px
  space-24: 96px
  space-32: 128px
```

#### Grid System:

```yaml
Desktop Grid (1440px):
  Columns: 12
  Margin: 80px
  Gutter: 24px

Tablet Grid (768px):
  Columns: 8
  Margin: 40px
  Gutter: 20px

Mobile Grid (375px):
  Columns: 4
  Margin: 16px
  Gutter: 16px
```

### 1.4 Shadows & Effects

#### Create these effect styles:

```yaml
Shadows:
  shadow/xs:
    X: 0
    Y: 1px
    Blur: 2px
    Color: rgba(0, 0, 0, 0.05)

  shadow/sm:
    X: 0
    Y: 1px
    Blur: 3px
    Color: rgba(0, 0, 0, 0.10)

  shadow/base:
    X: 0
    Y: 4px
    Blur: 6px
    Spread: -1px
    Color: rgba(0, 0, 0, 0.10)

  shadow/md:
    X: 0
    Y: 10px
    Blur: 15px
    Spread: -3px
    Color: rgba(0, 0, 0, 0.10)

  shadow/lg:
    X: 0
    Y: 20px
    Blur: 25px
    Spread: -5px
    Color: rgba(0, 0, 0, 0.10)

  shadow/xl:
    X: 0
    Y: 25px
    Blur: 50px
    Spread: -12px
    Color: rgba(0, 0, 0, 0.25)

Border Radius:
  radius/none: 0px
  radius/xs: 2px
  radius/sm: 4px
  radius/base: 6px
  radius/md: 8px
  radius/lg: 12px
  radius/xl: 16px
  radius/2xl: 24px
  radius/full: 9999px
```

---

## 2. Component Library

### 2.1 Atoms (Base Components)

#### Button Component

```yaml
Button Variants:
  Primary:
    Background: primary/500
    Text: white
    Hover: primary/600
    Active: primary/700
    Disabled: gray/300

  Secondary:
    Background: white
    Border: gray/300
    Text: gray/700
    Hover Background: gray/50
    Active: gray/100

  Ghost:
    Background: transparent
    Text: primary/500
    Hover Background: primary/50
    Active: primary/100

  Danger:
    Background: danger/base
    Text: white
    Hover: danger/dark

Button Sizes:
  Large:
    Height: 48px
    Padding: 12px 24px
    Text: Button/Large

  Medium:
    Height: 40px
    Padding: 10px 20px
    Text: Button/Base

  Small:
    Height: 32px
    Padding: 6px 12px
    Text: Button/Small

States:
  - Default
  - Hover
  - Active
  - Disabled
  - Loading (with spinner)
```

#### Input Field Component

```yaml
Input Variants:
  Default:
    Border: gray/300
    Background: white
    Focus Border: primary/500

  Error:
    Border: danger/base
    Background: danger/light

  Success:
    Border: success/base
    Background: success/light

Input Sizes:
  Large:
    Height: 48px
    Padding: 12px 16px
    Font: Body/Base

  Medium:
    Height: 40px
    Padding: 10px 14px
    Font: Body/Base

  Small:
    Height: 32px
    Padding: 6px 12px
    Font: Body/Small

States:
  - Default
  - Hover
  - Focus
  - Disabled
  - Error
  - Success
```

### 2.2 Molecules (Composite Components)

#### IPO Card Component

```yaml
Structure:
  Container:
    Width: 340px
    Padding: 24px
    Background: white
    Border Radius: radius/lg
    Shadow: shadow/base

  Sections:
    1. Header:
       - Logo (48x48px)
       - Company Name (Heading/H4)
       - Category Badge
       - Rating Stars

    2. Price Info:
       - Price Range
       - Lot Size
       - Min Investment

    3. Subscription Bar:
       - Progress Bar
       - Percentage Text
       - Category Breakdown

    4. GMP Section:
       - Current GMP
       - Expected Listing

    5. Actions:
       - View Button
       - Track Button
       - Apply Button
```

#### Navigation Component

```yaml
Desktop Navigation:
  Height: 64px
  Background: white
  Shadow: shadow/sm

  Logo Section:
    Width: 200px

  Menu Items:
    Gap: 32px
    Font: Body/Base
    Active Color: primary/500

  User Section:
    Avatar: 40x40px
    Dropdown Menu

Mobile Navigation:
  Bottom Tab Bar:
    Height: 56px
    Icons: 24x24px
    Label: Label/Base
    Active Color: primary/500
```

### 2.3 Organisms (Complex Components)

#### Dashboard Layout

```yaml
Structure:
  Header: 64px

  Hero Section:
    Height: 200px
    Gradient Background

  Stats Bar:
    Height: 120px
    Grid: 5 columns

  Content Area:
    Left Column: 70%
    Right Column: 30%
    Gap: 24px

  IPO Grid:
    Columns: Auto-fill
    Min Width: 340px
    Gap: 24px
```

---

## 3. Design Tokens (Variables)

### 3.1 Create Variable Collections

In Figma, set up variable collections for:

```yaml
Primitives:
  Colors:
    - All color values

  Numbers:
    - Spacing values
    - Border radius values
    - Font sizes
    - Line heights

Semantic:
  Background:
    - bg-primary
    - bg-secondary
    - bg-tertiary

  Text:
    - text-primary
    - text-secondary
    - text-disabled

  Border:
    - border-default
    - border-hover
    - border-focus

Component:
  Button:
    - button-primary-bg
    - button-primary-text
    - button-primary-hover

  Card:
    - card-bg
    - card-border
    - card-shadow
```

### 3.2 Create Modes

```yaml
Light Mode:
  bg-primary: white
  text-primary: gray/900
  border-default: gray/300

Dark Mode:
  bg-primary: gray/900
  text-primary: gray/50
  border-default: gray/700
```

---

## 4. Component Documentation

### 4.1 Component Annotation

For each component, create documentation frames:

```yaml
Component Doc Template:
  Title: [Component Name]

  Description:
    Purpose and usage guidelines

  Anatomy:
    Visual breakdown of component parts

  Variants:
    All available variations

  States:
    Interactive states demonstration

  Do's and Don'ts:
    Best practices with examples

  Implementation Notes:
    Developer handoff specifications
```

### 4.2 Usage Guidelines

```yaml
Naming Convention:
  Components: PascalCase (e.g., ButtonPrimary)
  Variants: kebab-case (e.g., button-primary-large)
  Colors: slash notation (e.g., primary/500)
  Spacing: hyphen notation (e.g., space-4)

Layer Organization:
  - Use frames for component boundaries
  - Group related elements
  - Name all layers descriptively
  - Use auto-layout wherever possible

Component Properties:
  - Text: Use text properties
  - Boolean: Show/hide elements
  - Instance Swap: For icons/avatars
  - Variant: For different states
```

---

## 5. Prototyping Guidelines

### 5.1 Interactive Prototypes

```yaml
Micro-interactions:
  Button Click:
    - Trigger: On Click
    - Action: Change To
    - Animation: Smart Animate
    - Duration: 200ms
    - Easing: Ease Out

  Card Hover:
    - Trigger: While Hovering
    - Action: Change To
    - Animation: Smart Animate
    - Duration: 150ms

  Page Transition:
    - Trigger: On Click
    - Action: Navigate To
    - Animation: Slide In
    - Duration: 300ms
    - Easing: Ease In Out

Loading States:
  Skeleton:
    - Create loading variant
    - Use smart animate
    - Loop animation

  Spinner:
    - Create spinning component
    - After Delay trigger
    - Continuous rotation
```

### 5.2 Flow Creation

```yaml
User Flows:
  1. IPO Application Flow:
     Start → Dashboard → IPO Details → Apply → Confirmation

  2. Allotment Check Flow:
     Start → Tools → Allotment Checker → Input → Result

  3. Portfolio Flow:
     Start → Login → Portfolio → Application Details

Device Specific:
  - Create separate flows for mobile
  - Use device frames
  - Set appropriate starting points
```

---

## 6. Figma Plugins to Install

### Essential Plugins:

```yaml
Design System:
  - Design System Organizer
  - Figma Tokens
  - Style Organizer

Content:
  - Content Reel (dummy data)
  - Unsplash (images)
  - Iconify (icons)

Workflow:
  - Auto Layout
  - Figma to Code
  - Stark (accessibility)
  - Figma Charts

Export:
  - Export Styles
  - Design Tokens
  - Figma to React
```

---

## 7. File Setup Instructions

### Step 1: Create New Figma File
1. Create new design file
2. Name it "IPODhan Design System"
3. Set up pages as per structure

### Step 2: Import Foundations
1. Create color styles
2. Set up typography
3. Define spacing tokens
4. Add effect styles

### Step 3: Build Components
1. Start with atoms
2. Combine into molecules
3. Create organisms
4. Build templates

### Step 4: Create Variants
1. Select component
2. Click "Create Component Set"
3. Add variants for states
4. Set up interactive components

### Step 5: Set Up Prototyping
1. Create user flows
2. Add interactions
3. Set up animations
4. Test prototypes

### Step 6: Documentation
1. Create cover page
2. Add component specs
3. Write usage guidelines
4. Include handoff notes

---

## 8. Handoff Specifications

### Developer Handoff:

```yaml
Export Settings:
  iOS:
    - @1x, @2x, @3x
    - PNG for images
    - SVG for icons

  Android:
    - mdpi, hdpi, xhdpi, xxhdpi, xxxhdpi
    - PNG for images
    - Vector drawables for icons

  Web:
    - SVG for icons
    - PNG/WebP for images
    - 1x, 2x for retina

CSS Variables:
  /* Copy these to your CSS */
  :root {
    /* Colors */
    --primary-500: #3B82F6;
    --gray-900: #111827;

    /* Spacing */
    --space-4: 16px;
    --space-8: 32px;

    /* Typography */
    --font-base: 16px;
    --line-height-base: 1.5;
  }

Component Code:
  - Use Figma Dev Mode
  - Copy CSS properties
  - Export React components
  - Get spacing values
```

---

## 9. Collaboration Guidelines

### Team Workflow:

```yaml
Branching:
  Main: Published components
  Dev: Work in progress
  Review: For feedback

Commenting:
  - Use comments for feedback
  - Resolve when addressed
  - Tag team members
  - Use status labels

Version Control:
  - Save versions before major changes
  - Name versions descriptively
  - Document changes
  - Regular backups

Permissions:
  - View only for stakeholders
  - Can edit for designers
  - Dev mode for developers
```

---

## 10. Quick Start Checklist

### ✅ Foundation Setup
- [ ] Create color styles
- [ ] Set up typography scale
- [ ] Define spacing system
- [ ] Add shadow effects
- [ ] Configure grids

### ✅ Component Creation
- [ ] Build button component
- [ ] Create input fields
- [ ] Design cards
- [ ] Make navigation
- [ ] Build forms

### ✅ Documentation
- [ ] Add component descriptions
- [ ] Create usage examples
- [ ] Write guidelines
- [ ] Set up handoff specs

### ✅ Prototyping
- [ ] Link screens
- [ ] Add interactions
- [ ] Create user flows
- [ ] Test on devices

### ✅ Collaboration
- [ ] Share with team
- [ ] Set permissions
- [ ] Create library
- [ ] Publish components

---

## Resources & Links

### Figma Community Files:
- Search "IPO Dashboard" for inspiration
- "Finance App UI Kit" for components
- "Design System Template" for structure

### Icon Libraries:
- Heroicons
- Feather Icons
- Phosphor Icons
- Tabler Icons

### Useful Links:
- [Figma Best Practices](https://www.figma.com/best-practices/)
- [Design Tokens](https://www.figma.com/community/plugin/888356646278934516)
- [Auto Layout Guide](https://help.figma.com/hc/en-us/articles/5731482952599)

---

*This guide provides everything you need to create a professional design system in Figma for IPODhan. Follow the steps sequentially for best results.*
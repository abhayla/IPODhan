# IPODhan Figma Component Specifications

## 🎯 Quick Copy-Paste Values for Figma

### Color Values (Hex)
```
/* Primary Blue Scale */
#EFF6FF
#DBEAFE
#BFDBFE
#93C5FD
#60A5FA
#3B82F6  /* Main Brand */
#2563EB
#1D4ED8
#1E40AF
#1E3A8A

/* Success Green */
#D1FAE5
#10B981
#059669

/* Warning Yellow */
#FEF3C7
#F59E0B
#D97706

/* Danger Red */
#FEE2E2
#EF4444
#DC2626

/* Purple Accent */
#EDE9FE
#8B5CF6
#7C3AED

/* Gray Scale */
#F9FAFB
#F3F4F6
#E5E7EB
#D1D5DB
#9CA3AF
#6B7280
#4B5563
#374151
#1F2937
#111827
```

---

## Component Specifications

### 1. IPO Card Component (Desktop)

```yaml
Container:
  Width: 380px
  Height: Auto (approx 420px)
  Padding: 24px
  Background: #FFFFFF
  Border Radius: 12px
  Shadow: 0px 4px 6px rgba(0, 0, 0, 0.10)

Layout Structure:
  ┌──────────────────────────────────┐
  │  [Logo]  Company Name      ★4.2  │  Height: 48px
  │          Category | Exchange      │
  ├──────────────────────────────────┤
  │  Price: ₹280-300 | Lot: 50       │  Height: 60px
  │  Min Investment: ₹15,000         │
  ├──────────────────────────────────┤
  │  Opens: Jan 15 | Closes: Jan 17  │  Height: 40px
  ├──────────────────────────────────┤
  │  Subscription Status [LIVE]       │  Height: 100px
  │  ████████░░░░░░  2.3x            │
  │  R: 3.2x | Q: 1.8x | N: 2.1x     │
  ├──────────────────────────────────┤
  │  GMP: +₹45 (15%) | Est: ₹345     │  Height: 48px
  ├──────────────────────────────────┤
  │  [View] [Track] [Apply Now]       │  Height: 40px
  └──────────────────────────────────┘

Spacing:
  Between sections: 16px
  Internal padding: 12px
```

### 2. Button Component Specifications

```yaml
Primary Button:
  Large:
    Width: Auto (min 120px)
    Height: 48px
    Padding: 12px 24px
    Background: #3B82F6
    Text: #FFFFFF, 16px, Semi-Bold
    Border Radius: 8px
    Hover: #2563EB
    Active: #1D4ED8
    Disabled: #D1D5DB

  Medium:
    Width: Auto (min 100px)
    Height: 40px
    Padding: 10px 20px
    Background: #3B82F6
    Text: #FFFFFF, 14px, Semi-Bold
    Border Radius: 6px

  Small:
    Width: Auto (min 80px)
    Height: 32px
    Padding: 6px 12px
    Background: #3B82F6
    Text: #FFFFFF, 12px, Semi-Bold
    Border Radius: 4px

Secondary Button:
  Same sizes as Primary but:
    Background: #FFFFFF
    Border: 1px solid #D1D5DB
    Text: #374151
    Hover Background: #F3F4F6
```

### 3. Input Field Specifications

```yaml
Text Input:
  Default:
    Width: Variable (min 200px)
    Height: 40px
    Padding: 10px 14px
    Border: 2px solid #D1D5DB
    Border Radius: 6px
    Background: #FFFFFF
    Placeholder: #9CA3AF, 14px
    Text: #111827, 14px

  Focus:
    Border: 2px solid #3B82F6
    Shadow: 0px 0px 0px 3px rgba(59, 130, 246, 0.1)

  Error:
    Border: 2px solid #EF4444
    Background: #FEE2E2

Label:
  Font: Inter, 14px, Medium
  Color: #374151
  Margin Bottom: 6px

Helper Text:
  Font: Inter, 12px, Regular
  Color: #6B7280
  Margin Top: 4px
```

### 4. Navigation Bar (Desktop)

```yaml
Container:
  Width: 100%
  Height: 64px
  Background: #FFFFFF
  Border Bottom: 1px solid #E5E7EB
  Padding: 0 80px (desktop), 0 16px (mobile)

Logo Section:
  Width: 180px
  Font: Inter, 24px, Bold
  Color: #3B82F6

Menu Items:
  Font: Inter, 14px, Medium
  Color: #374151
  Hover: #3B82F6
  Active: #3B82F6 with underline
  Spacing: 32px between items

User Section:
  Avatar: 40px × 40px circle
  Name: Inter, 14px, Medium, #111827
  Dropdown Icon: 16px × 16px
```

### 5. Status Badges

```yaml
Live Badge:
  Padding: 4px 12px
  Background: #10B981
  Text: #FFFFFF, 11px, Semi-Bold
  Border Radius: 9999px
  Animation: Pulse

Upcoming Badge:
  Padding: 4px 12px
  Background: #3B82F6
  Text: #FFFFFF, 11px, Semi-Bold
  Border Radius: 9999px

Closed Badge:
  Padding: 4px 12px
  Background: #6B7280
  Text: #FFFFFF, 11px, Semi-Bold
  Border Radius: 9999px
```

### 6. Mobile Components

```yaml
Mobile IPO Card:
  Width: 100% - 32px (16px margins)
  Padding: 16px
  Similar structure but stacked vertically

Bottom Navigation:
  Height: 56px
  Background: #FFFFFF
  Border Top: 1px solid #E5E7EB
  Icons: 24px × 24px
  Label: 10px, Regular
  Active Color: #3B82F6
  Inactive Color: #9CA3AF
```

### 7. Data Visualization

```yaml
Progress Bar:
  Height: 8px
  Background: #E5E7EB
  Fill: #3B82F6 (or contextual color)
  Border Radius: 4px

  With Text:
    Height: 24px
    Text Inside: 12px, Semi-Bold, #FFFFFF
    Text Outside: 14px, Semi-Bold, #111827

Donut Chart:
  Size: 120px × 120px
  Stroke Width: 16px
  Colors: [#3B82F6, #8B5CF6, #10B981]
  Center Text: 24px, Bold

Bar Chart:
  Bar Width: 40px
  Bar Spacing: 16px
  Colors: #3B82F6 (positive), #EF4444 (negative)
  Grid Lines: #E5E7EB, 1px
  Labels: 12px, Regular, #6B7280
```

### 8. Card Layouts

```yaml
Stats Card:
  Width: 280px
  Height: 120px
  Padding: 20px
  Background: #FFFFFF
  Border Radius: 12px
  Shadow: 0px 1px 3px rgba(0, 0, 0, 0.10)

  Icon Box:
    Size: 48px × 48px
    Background: #EFF6FF
    Border Radius: 8px
    Icon: 24px × 24px, #3B82F6

  Value:
    Font: 28px, Bold, #111827

  Label:
    Font: 14px, Regular, #6B7280

  Change Indicator:
    Font: 12px, Semi-Bold
    Positive: #10B981, Background: #D1FAE5
    Negative: #EF4444, Background: #FEE2E2
    Padding: 2px 8px
    Border Radius: 9999px
```

### 9. Form Components

```yaml
Checkbox:
  Size: 20px × 20px
  Border: 2px solid #D1D5DB
  Border Radius: 4px
  Checked: Background #3B82F6, Check: #FFFFFF

Radio Button:
  Size: 20px × 20px
  Border: 2px solid #D1D5DB
  Border Radius: 50%
  Selected: Border #3B82F6, Dot: 12px, #3B82F6

Toggle Switch:
  Width: 44px
  Height: 24px
  Background: #D1D5DB (off), #3B82F6 (on)
  Border Radius: 9999px
  Knob: 20px × 20px, #FFFFFF
  Animation: Slide 200ms

Dropdown:
  Same as Text Input +
  Arrow Icon: 20px × 20px, #6B7280
  Dropdown Menu:
    Background: #FFFFFF
    Border: 1px solid #E5E7EB
    Shadow: 0px 10px 15px rgba(0, 0, 0, 0.10)
    Item Height: 40px
    Item Hover: #F3F4F6
```

### 10. Tables

```yaml
Table Header:
  Height: 48px
  Background: #F9FAFB
  Border Bottom: 2px solid #E5E7EB
  Font: 12px, Semi-Bold, #374151
  Text Transform: Uppercase
  Letter Spacing: 0.5px

Table Row:
  Height: 56px
  Border Bottom: 1px solid #E5E7EB
  Hover Background: #F9FAFB
  Font: 14px, Regular, #111827

Table Cell:
  Padding: 16px
  Alignment: Left (text), Right (numbers)
```

### 11. Modal/Dialog

```yaml
Overlay:
  Background: rgba(0, 0, 0, 0.50)
  Blur: 4px

Modal Container:
  Width: 480px (desktop), 90% (mobile)
  Max Height: 90vh
  Background: #FFFFFF
  Border Radius: 16px
  Shadow: 0px 25px 50px rgba(0, 0, 0, 0.25)
  Padding: 24px

Modal Header:
  Font: 20px, Semi-Bold, #111827
  Padding Bottom: 16px
  Border Bottom: 1px solid #E5E7EB

Modal Body:
  Padding: 24px 0
  Max Height: calc(90vh - 200px)
  Overflow: Auto

Modal Footer:
  Padding Top: 16px
  Border Top: 1px solid #E5E7EB
  Button Alignment: Right
  Button Spacing: 12px
```

### 12. Toast Notifications

```yaml
Toast Container:
  Width: 360px
  Padding: 16px
  Border Radius: 8px
  Shadow: 0px 10px 15px rgba(0, 0, 0, 0.10)

Success Toast:
  Background: #10B981
  Text: #FFFFFF
  Icon: ✓ in 20px circle

Error Toast:
  Background: #EF4444
  Text: #FFFFFF
  Icon: ✗ in 20px circle

Warning Toast:
  Background: #F59E0B
  Text: #FFFFFF
  Icon: ⚠ in 20px circle

Info Toast:
  Background: #3B82F6
  Text: #FFFFFF
  Icon: ⓘ in 20px circle
```

---

## Responsive Breakpoints

```yaml
Mobile: 320px - 767px
Tablet: 768px - 1023px
Desktop: 1024px - 1439px
Large Desktop: 1440px+

Container Max Widths:
Mobile: 100% - 32px (16px padding)
Tablet: 100% - 80px (40px padding)
Desktop: 1280px
Large Desktop: 1440px
```

---

## Animation Specifications

```yaml
Micro-interactions:
  Duration: 150ms - 300ms
  Easing: Cubic Bezier (0.4, 0, 0.2, 1)

Page Transitions:
  Duration: 300ms - 500ms
  Easing: Cubic Bezier (0.4, 0, 0.2, 1)

Loading:
  Skeleton: Pulse 1.5s infinite
  Spinner: Rotate 1s infinite linear

Hover Effects:
  Scale: 1.02 - 1.05
  Shadow: Increase by 50%
  Color: Darken by 10%
```

---

## Icon Sizes

```yaml
Extra Small: 12px × 12px (inline text)
Small: 16px × 16px (buttons, inputs)
Medium: 20px × 20px (default)
Large: 24px × 24px (primary actions)
Extra Large: 32px × 32px (feature icons)
Hero: 48px × 48px (illustrations)
```

---

## Z-Index Scale

```yaml
Base: 0
Dropdown: 10
Sticky: 20
Fixed: 30
Modal Backdrop: 40
Modal: 50
Toast: 60
Tooltip: 70
```

---

## Quick Figma Tips

### Auto Layout Settings:
```
Spacing between items: 8px, 12px, 16px, 24px
Padding: 12px, 16px, 20px, 24px
Alignment: Top-Left (default), Center (CTAs)
```

### Component Properties:
```
Text: String property
Boolean: Show/Hide layers
Instance Swap: Icons, Avatars
Variant: States, Sizes, Types
```

### Naming Convention:
```
Components: Component/Variant
Colors: primary/500
Icons: icon/name/size
Spacing: space-4 (equals 16px)
```

---

*Use these specifications to create pixel-perfect components in Figma that match the IPODhan design system.*
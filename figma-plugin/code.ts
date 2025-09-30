/// <reference path="./node_modules/@figma/plugin-typings/index.d.ts" />

// IPODhan Design System Generator - Main Plugin Code
// This plugin automatically creates a complete design system in Figma

// Show UI
figma.showUI(__html__, {
  width: 400,
  height: 600,
  title: "IPODhan Design System Generator"
});

// ============================================
// COLOR SYSTEM
// ============================================

const colors = {
  // Primary Blue Scale
  'Primary/50': { hex: '#EFF6FF', rgb: { r: 0.937, g: 0.965, b: 1 } },
  'Primary/100': { hex: '#DBEAFE', rgb: { r: 0.859, g: 0.918, b: 0.996 } },
  'Primary/200': { hex: '#BFDBFE', rgb: { r: 0.749, g: 0.859, b: 0.996 } },
  'Primary/300': { hex: '#93C5FD', rgb: { r: 0.576, g: 0.773, b: 0.992 } },
  'Primary/400': { hex: '#60A5FA', rgb: { r: 0.376, g: 0.647, b: 0.98 } },
  'Primary/500': { hex: '#3B82F6', rgb: { r: 0.231, g: 0.51, b: 0.965 } },
  'Primary/600': { hex: '#2563EB', rgb: { r: 0.145, g: 0.388, b: 0.922 } },
  'Primary/700': { hex: '#1D4ED8', rgb: { r: 0.114, g: 0.306, b: 0.847 } },
  'Primary/800': { hex: '#1E40AF', rgb: { r: 0.118, g: 0.251, b: 0.686 } },
  'Primary/900': { hex: '#1E3A8A', rgb: { r: 0.118, g: 0.227, b: 0.541 } },

  // Semantic Colors
  'Success/Light': { hex: '#D1FAE5', rgb: { r: 0.82, g: 0.98, b: 0.898 } },
  'Success/Base': { hex: '#10B981', rgb: { r: 0.063, g: 0.725, b: 0.506 } },
  'Success/Dark': { hex: '#059669', rgb: { r: 0.02, g: 0.588, b: 0.412 } },

  'Warning/Light': { hex: '#FEF3C7', rgb: { r: 0.996, g: 0.953, b: 0.78 } },
  'Warning/Base': { hex: '#F59E0B', rgb: { r: 0.961, g: 0.62, b: 0.043 } },
  'Warning/Dark': { hex: '#D97706', rgb: { r: 0.851, g: 0.467, b: 0.024 } },

  'Danger/Light': { hex: '#FEE2E2', rgb: { r: 0.996, g: 0.886, b: 0.886 } },
  'Danger/Base': { hex: '#EF4444', rgb: { r: 0.937, g: 0.267, b: 0.267 } },
  'Danger/Dark': { hex: '#DC2626', rgb: { r: 0.863, g: 0.149, b: 0.149 } },

  // Purple Accent
  'Purple/500': { hex: '#8B5CF6', rgb: { r: 0.545, g: 0.361, b: 0.965 } },
  'Purple/600': { hex: '#7C3AED', rgb: { r: 0.486, g: 0.227, b: 0.929 } },

  // Gray Scale
  'Gray/50': { hex: '#F9FAFB', rgb: { r: 0.976, g: 0.98, b: 0.984 } },
  'Gray/100': { hex: '#F3F4F6', rgb: { r: 0.953, g: 0.957, b: 0.965 } },
  'Gray/200': { hex: '#E5E7EB', rgb: { r: 0.898, g: 0.906, b: 0.922 } },
  'Gray/300': { hex: '#D1D5DB', rgb: { r: 0.82, g: 0.835, b: 0.859 } },
  'Gray/400': { hex: '#9CA3AF', rgb: { r: 0.612, g: 0.639, b: 0.686 } },
  'Gray/500': { hex: '#6B7280', rgb: { r: 0.42, g: 0.447, b: 0.502 } },
  'Gray/600': { hex: '#4B5563', rgb: { r: 0.294, g: 0.333, b: 0.388 } },
  'Gray/700': { hex: '#374151', rgb: { r: 0.216, g: 0.255, b: 0.318 } },
  'Gray/800': { hex: '#1F2937', rgb: { r: 0.122, g: 0.161, b: 0.216 } },
  'Gray/900': { hex: '#111827', rgb: { r: 0.067, g: 0.094, b: 0.153 } }
};

// ============================================
// TYPOGRAPHY SYSTEM
// ============================================

const typography = {
  // Display
  'Display/2XL': { fontSize: 72, lineHeight: 90, letterSpacing: -2, fontWeight: 700 },
  'Display/XL': { fontSize: 60, lineHeight: 72, letterSpacing: -2, fontWeight: 700 },
  'Display/Large': { fontSize: 48, lineHeight: 60, letterSpacing: -1, fontWeight: 700 },

  // Headings
  'Heading/H1': { fontSize: 36, lineHeight: 44, letterSpacing: -0.5, fontWeight: 700 },
  'Heading/H2': { fontSize: 30, lineHeight: 38, letterSpacing: 0, fontWeight: 600 },
  'Heading/H3': { fontSize: 24, lineHeight: 32, letterSpacing: 0, fontWeight: 600 },
  'Heading/H4': { fontSize: 20, lineHeight: 28, letterSpacing: 0, fontWeight: 600 },
  'Heading/H5': { fontSize: 18, lineHeight: 26, letterSpacing: 0, fontWeight: 500 },
  'Heading/H6': { fontSize: 16, lineHeight: 24, letterSpacing: 0, fontWeight: 500 },

  // Body
  'Body/Large': { fontSize: 18, lineHeight: 28, letterSpacing: 0, fontWeight: 400 },
  'Body/Base': { fontSize: 16, lineHeight: 24, letterSpacing: 0, fontWeight: 400 },
  'Body/Small': { fontSize: 14, lineHeight: 20, letterSpacing: 0, fontWeight: 400 },
  'Body/XSmall': { fontSize: 12, lineHeight: 16, letterSpacing: 0, fontWeight: 400 },

  // Special
  'Label/Large': { fontSize: 14, lineHeight: 20, letterSpacing: 0.5, fontWeight: 500 },
  'Label/Base': { fontSize: 12, lineHeight: 16, letterSpacing: 0.5, fontWeight: 500 },
  'Caption': { fontSize: 12, lineHeight: 16, letterSpacing: 0, fontWeight: 400 },
  'Button/Large': { fontSize: 16, lineHeight: 24, letterSpacing: 0.5, fontWeight: 600 },
  'Button/Base': { fontSize: 14, lineHeight: 20, letterSpacing: 0.5, fontWeight: 600 },
  'Button/Small': { fontSize: 12, lineHeight: 16, letterSpacing: 0.5, fontWeight: 600 }
};

// ============================================
// SHADOW EFFECTS
// ============================================

const shadows = {
  'Shadow/xs': {
    effects: [{
      type: 'DROP_SHADOW',
      color: { r: 0, g: 0, b: 0, a: 0.05 },
      offset: { x: 0, y: 1 },
      radius: 2,
      spread: 0,
      visible: true,
      blendMode: 'NORMAL'
    }]
  },
  'Shadow/sm': {
    effects: [{
      type: 'DROP_SHADOW',
      color: { r: 0, g: 0, b: 0, a: 0.1 },
      offset: { x: 0, y: 1 },
      radius: 3,
      spread: 0,
      visible: true,
      blendMode: 'NORMAL'
    }]
  },
  'Shadow/base': {
    effects: [{
      type: 'DROP_SHADOW',
      color: { r: 0, g: 0, b: 0, a: 0.1 },
      offset: { x: 0, y: 4 },
      radius: 6,
      spread: -1,
      visible: true,
      blendMode: 'NORMAL'
    }]
  },
  'Shadow/md': {
    effects: [{
      type: 'DROP_SHADOW',
      color: { r: 0, g: 0, b: 0, a: 0.1 },
      offset: { x: 0, y: 10 },
      radius: 15,
      spread: -3,
      visible: true,
      blendMode: 'NORMAL'
    }]
  },
  'Shadow/lg': {
    effects: [{
      type: 'DROP_SHADOW',
      color: { r: 0, g: 0, b: 0, a: 0.1 },
      offset: { x: 0, y: 20 },
      radius: 25,
      spread: -5,
      visible: true,
      blendMode: 'NORMAL'
    }]
  },
  'Shadow/xl': {
    effects: [{
      type: 'DROP_SHADOW',
      color: { r: 0, g: 0, b: 0, a: 0.25 },
      offset: { x: 0, y: 25 },
      radius: 50,
      spread: -12,
      visible: true,
      blendMode: 'NORMAL'
    }]
  }
};

// ============================================
// PLUGIN MESSAGE HANDLERS
// ============================================

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'create-colors') {
    await createColorStyles();
    figma.ui.postMessage({ type: 'colors-created' });
  }

  if (msg.type === 'create-typography') {
    await createTypographyStyles();
    figma.ui.postMessage({ type: 'typography-created' });
  }

  if (msg.type === 'create-shadows') {
    await createShadowStyles();
    figma.ui.postMessage({ type: 'shadows-created' });
  }

  if (msg.type === 'create-components') {
    await createComponents();
    figma.ui.postMessage({ type: 'components-created' });
  }

  if (msg.type === 'create-all') {
    await createColorStyles();
    await createTypographyStyles();
    await createShadowStyles();
    await createComponents();
    figma.ui.postMessage({ type: 'all-created' });
  }

  if (msg.type === 'close') {
    figma.closePlugin();
  }
};

// ============================================
// CREATE COLOR STYLES
// ============================================

async function createColorStyles() {
  const localPaintStyles = figma.getLocalPaintStyles();

  for (const [name, color] of Object.entries(colors)) {
    // Check if style already exists
    const existingStyle = localPaintStyles.find(style => style.name === name);

    let style: PaintStyle;
    if (existingStyle) {
      style = existingStyle;
    } else {
      style = figma.createPaintStyle();
    }

    style.name = name;
    style.paints = [{
      type: 'SOLID',
      color: color.rgb,
      opacity: 1
    }];

    // Add description with hex value
    style.description = color.hex;
  }

  figma.notify('✅ Color styles created successfully!');
}

// ============================================
// CREATE TYPOGRAPHY STYLES
// ============================================

async function createTypographyStyles() {
  const localTextStyles = figma.getLocalTextStyles();

  // Load font
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Medium" });
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });

  for (const [name, props] of Object.entries(typography)) {
    const existingStyle = localTextStyles.find(style => style.name === name);

    let style: TextStyle;
    if (existingStyle) {
      style = existingStyle;
    } else {
      style = figma.createTextStyle();
    }

    style.name = name;
    style.fontSize = props.fontSize;
    style.lineHeight = { value: props.lineHeight, unit: 'PIXELS' };

    // Set letter spacing
    if (props.letterSpacing !== 0) {
      style.letterSpacing = { value: props.letterSpacing, unit: 'PERCENT' };
    }

    // Set font weight
    let fontStyle = "Regular";
    if (props.fontWeight === 500) fontStyle = "Medium";
    if (props.fontWeight === 600) fontStyle = "Semi Bold";
    if (props.fontWeight === 700) fontStyle = "Bold";

    style.fontName = { family: "Inter", style: fontStyle };
  }

  figma.notify('✅ Typography styles created successfully!');
}

// ============================================
// CREATE SHADOW STYLES
// ============================================

async function createShadowStyles() {
  const localEffectStyles = figma.getLocalEffectStyles();

  for (const [name, shadow] of Object.entries(shadows)) {
    const existingStyle = localEffectStyles.find(style => style.name === name);

    let style: EffectStyle;
    if (existingStyle) {
      style = existingStyle;
    } else {
      style = figma.createEffectStyle();
    }

    style.name = name;
    style.effects = shadow.effects as readonly Effect[];
  }

  figma.notify('✅ Shadow styles created successfully!');
}

// ============================================
// CREATE COMPONENTS
// ============================================

async function createComponents() {
  const page = figma.currentPage;

  // Create frames for organization
  const componentsFrame = figma.createFrame();
  componentsFrame.name = "📦 Components";
  componentsFrame.resize(2000, 2000);
  componentsFrame.x = 0;
  componentsFrame.y = 0;

  // Create Button Component
  await createButtonComponent(componentsFrame);

  // Create Input Component
  await createInputComponent(componentsFrame);

  // Create Card Component
  await createCardComponent(componentsFrame);

  // Create Badge Component
  await createBadgeComponent(componentsFrame);

  // Create IPO Card Component
  await createIPOCardComponent(componentsFrame);

  figma.notify('✅ Components created successfully!');

  // Focus on the components frame
  figma.viewport.scrollAndZoomIntoView([componentsFrame]);
}

// ============================================
// BUTTON COMPONENT
// ============================================

async function createButtonComponent(parent: FrameNode) {
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });

  // Create a frame to hold button variants
  const buttonSet = figma.createFrame();
  buttonSet.name = "Button Components";
  buttonSet.x = 50;
  buttonSet.y = 50;
  buttonSet.layoutMode = 'HORIZONTAL';
  buttonSet.itemSpacing = 20;
  parent.appendChild(buttonSet);

  // Define button properties
  const variants = [
    { variant: 'Primary', size: 'Large', state: 'Default' },
    { variant: 'Primary', size: 'Large', state: 'Hover' },
    { variant: 'Primary', size: 'Medium', state: 'Default' },
    { variant: 'Primary', size: 'Medium', state: 'Hover' },
    { variant: 'Primary', size: 'Small', state: 'Default' },
    { variant: 'Primary', size: 'Small', state: 'Hover' },
    { variant: 'Secondary', size: 'Large', state: 'Default' },
    { variant: 'Secondary', size: 'Large', state: 'Hover' },
    { variant: 'Secondary', size: 'Medium', state: 'Default' },
    { variant: 'Secondary', size: 'Medium', state: 'Hover' }
  ];

  const buttonSizes = {
    Large: { width: 120, height: 48, fontSize: 16, padding: 24 },
    Medium: { width: 100, height: 40, fontSize: 14, padding: 20 },
    Small: { width: 80, height: 32, fontSize: 12, padding: 12 }
  };

  for (const props of variants) {
    const button = figma.createComponent();
    button.name = `Variant=${props.variant}, Size=${props.size}, State=${props.state}`;

    const size = buttonSizes[props.size];
    button.resize(size.width, size.height);
    button.cornerRadius = props.size === 'Large' ? 8 : props.size === 'Medium' ? 6 : 4;

    // Set auto layout
    button.layoutMode = 'HORIZONTAL';
    button.primaryAxisAlignItems = 'CENTER';
    button.counterAxisAlignItems = 'CENTER';
    button.paddingLeft = size.padding;
    button.paddingRight = size.padding;
    button.primaryAxisSizingMode = 'FIXED';
    button.counterAxisSizingMode = 'FIXED';

    // Apply colors based on variant and state
    if (props.variant === 'Primary') {
      const colorName = props.state === 'Hover' ? 'Primary/600' : 'Primary/500';
      const colorStyle = figma.getLocalPaintStyles().find(s => s.name === colorName);
      if (colorStyle) {
        button.fillStyleId = colorStyle.id;
      } else {
        button.fills = [{
          type: 'SOLID',
          color: props.state === 'Hover' ? colors['Primary/600'].rgb : colors['Primary/500'].rgb
        }];
      }
    } else {
      button.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
      button.strokes = [{
        type: 'SOLID',
        color: colors['Gray/300'].rgb
      }];
      button.strokeWeight = 1;
    }

    // Add text
    const text = figma.createText();
    text.characters = "Button";
    text.fontSize = size.fontSize;
    text.fontName = { family: "Inter", style: "Semi Bold" };
    text.fills = [{
      type: 'SOLID',
      color: props.variant === 'Primary' ? { r: 1, g: 1, b: 1 } : colors['Gray/700'].rgb
    }];

    button.appendChild(text);
    buttonSet.appendChild(button);
  }

  // Arrange variants in grid
  await arrangeComponentsInGrid(buttonSet);
}

// ============================================
// INPUT COMPONENT
// ============================================

async function createInputComponent(parent: FrameNode) {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });

  // Create a frame to hold input variants
  const inputSet = figma.createFrame();
  inputSet.name = "Input Components";
  inputSet.x = 50;
  inputSet.y = 300;
  inputSet.layoutMode = 'HORIZONTAL';
  inputSet.itemSpacing = 20;
  parent.appendChild(inputSet);

  const states = ['Default', 'Hover', 'Focus', 'Error', 'Disabled'];

  for (const state of states) {
    const input = figma.createComponent();
    input.name = `State=${state}`;
    input.resize(320, 40);
    input.cornerRadius = 6;

    // Set auto layout
    input.layoutMode = 'HORIZONTAL';
    input.primaryAxisAlignItems = 'CENTER';
    input.counterAxisAlignItems = 'CENTER';
    input.paddingLeft = 14;
    input.paddingRight = 14;

    // Background
    input.fills = [{
      type: 'SOLID',
      color: state === 'Error' ? colors['Danger/Light'].rgb : { r: 1, g: 1, b: 1 }
    }];

    // Border
    let borderColor = colors['Gray/300'].rgb;
    if (state === 'Focus') borderColor = colors['Primary/500'].rgb;
    if (state === 'Error') borderColor = colors['Danger/Base'].rgb;

    input.strokes = [{
      type: 'SOLID',
      color: borderColor
    }];
    input.strokeWeight = state === 'Focus' ? 2 : 1;

    // Add placeholder text
    const text = figma.createText();
    text.characters = state === 'Default' ? "Enter text..." : `Input ${state}`;
    text.fontSize = 14;
    text.fontName = { family: "Inter", style: "Regular" };
    text.fills = [{
      type: 'SOLID',
      color: state === 'Default' ? colors['Gray/400'].rgb : colors['Gray/900'].rgb
    }];

    if (state === 'Disabled') {
      text.opacity = 0.5;
      input.opacity = 0.6;
    }

    input.appendChild(text);
    inputSet.appendChild(input);
  }

  await arrangeComponentsInGrid(inputSet);
}

// ============================================
// CARD COMPONENT
// ============================================

async function createCardComponent(parent: FrameNode) {
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });

  const card = figma.createComponent();
  card.name = "Stats Card";
  card.x = 50;
  card.y = 500;
  card.resize(280, 120);
  card.cornerRadius = 12;
  parent.appendChild(card);

  // Set auto layout
  card.layoutMode = 'VERTICAL';
  card.paddingTop = 20;
  card.paddingBottom = 20;
  card.paddingLeft = 20;
  card.paddingRight = 20;
  card.itemSpacing = 12;

  // Background and shadow
  card.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];

  const shadowStyle = figma.getLocalEffectStyles().find(s => s.name === 'Shadow/sm');
  if (shadowStyle) {
    card.effectStyleId = shadowStyle.id;
  } else {
    card.effects = shadows['Shadow/sm'].effects as readonly Effect[];
  }

  // Icon box
  const iconBox = figma.createFrame();
  iconBox.name = "Icon";
  iconBox.resize(48, 48);
  iconBox.cornerRadius = 8;
  iconBox.fills = [{ type: 'SOLID', color: colors['Primary/100'].rgb }];

  // Icon (placeholder emoji)
  const icon = figma.createText();
  icon.characters = "📊";
  icon.fontSize = 24;
  icon.x = 12;
  icon.y = 12;
  iconBox.appendChild(icon);
  card.appendChild(iconBox);

  // Value
  const value = figma.createText();
  value.characters = "₹45,230";
  value.fontSize = 28;
  value.fontName = { family: "Inter", style: "Semi Bold" };
  value.fills = [{ type: 'SOLID', color: colors['Gray/900'].rgb }];
  card.appendChild(value);

  // Label
  const label = figma.createText();
  label.characters = "Total Returns";
  label.fontSize = 14;
  label.fontName = { family: "Inter", style: "Regular" };
  label.fills = [{ type: 'SOLID', color: colors['Gray/600'].rgb }];
  card.appendChild(label);
}

// ============================================
// BADGE COMPONENT
// ============================================

async function createBadgeComponent(parent: FrameNode) {
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });

  // Create a frame to hold badge variants
  const badgeSet = figma.createFrame();
  badgeSet.name = "Badge Components";
  badgeSet.x = 400;
  badgeSet.y = 50;
  badgeSet.layoutMode = 'HORIZONTAL';
  badgeSet.itemSpacing = 20;
  parent.appendChild(badgeSet);

  const badges = [
    { status: 'Live', color: 'Success' },
    { status: 'Upcoming', color: 'Primary' },
    { status: 'Closed', color: 'Gray' },
    { status: 'Listed', color: 'Purple' }
  ];

  for (const badge of badges) {
    const component = figma.createComponent();
    component.name = `Status=${badge.status}`;
    component.layoutMode = 'HORIZONTAL';
    component.paddingTop = 4;
    component.paddingBottom = 4;
    component.paddingLeft = 12;
    component.paddingRight = 12;
    component.cornerRadius = 9999;
    component.primaryAxisSizingMode = 'AUTO';
    component.counterAxisSizingMode = 'AUTO';

    // Set color based on status
    let bgColor = colors[`${badge.color}/Base`]?.rgb || colors['Gray/500'].rgb;
    if (badge.color === 'Gray') bgColor = colors['Gray/500'].rgb;
    if (badge.color === 'Purple') bgColor = colors['Purple/500'].rgb;
    if (badge.color === 'Primary') bgColor = colors['Primary/500'].rgb;
    if (badge.color === 'Success') bgColor = colors['Success/Base'].rgb;

    component.fills = [{ type: 'SOLID', color: bgColor }];

    // Add text
    const text = figma.createText();
    text.characters = badge.status.toUpperCase();
    text.fontSize = 11;
    text.fontName = { family: "Inter", style: "Semi Bold" };
    text.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    text.textCase = 'UPPER';

    component.appendChild(text);
    badgeSet.appendChild(component);
  }

  await arrangeComponentsInGrid(badgeSet);
}

// ============================================
// IPO CARD COMPONENT
// ============================================

async function createIPOCardComponent(parent: FrameNode) {
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Medium" });

  const ipoCard = figma.createComponent();
  ipoCard.name = "IPO Card";
  ipoCard.x = 50;
  ipoCard.y = 700;
  ipoCard.resize(380, 420);
  ipoCard.cornerRadius = 12;
  parent.appendChild(ipoCard);

  // Set auto layout
  ipoCard.layoutMode = 'VERTICAL';
  ipoCard.paddingTop = 24;
  ipoCard.paddingBottom = 24;
  ipoCard.paddingLeft = 24;
  ipoCard.paddingRight = 24;
  ipoCard.itemSpacing = 16;

  // Background and shadow
  ipoCard.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  const shadowStyle = figma.getLocalEffectStyles().find(s => s.name === 'Shadow/base');
  if (shadowStyle) {
    ipoCard.effectStyleId = shadowStyle.id;
  }

  // Header Section
  const header = figma.createFrame();
  header.layoutMode = 'HORIZONTAL';
  header.counterAxisAlignItems = 'CENTER';
  header.layoutAlign = 'STRETCH';
  header.primaryAxisSizingMode = 'FIXED';
  header.itemSpacing = 12;

  // Logo placeholder
  const logo = figma.createFrame();
  logo.resize(48, 48);
  logo.cornerRadius = 8;
  logo.fills = [{ type: 'SOLID', color: colors['Gray/200'].rgb }];
  header.appendChild(logo);

  // Company info
  const companyInfo = figma.createFrame();
  companyInfo.layoutMode = 'VERTICAL';
  companyInfo.layoutGrow = 1;

  const companyName = figma.createText();
  companyName.characters = "TechVista Solutions";
  companyName.fontSize = 18;
  companyName.fontName = { family: "Inter", style: "Semi Bold" };
  companyInfo.appendChild(companyName);

  const companyMeta = figma.createText();
  companyMeta.characters = "Mainboard | Technology";
  companyMeta.fontSize = 14;
  companyMeta.fontName = { family: "Inter", style: "Regular" };
  companyMeta.fills = [{ type: 'SOLID', color: colors['Gray/600'].rgb }];
  companyInfo.appendChild(companyMeta);

  header.appendChild(companyInfo);

  // Rating
  const rating = figma.createText();
  rating.characters = "★ 4.2";
  rating.fontSize = 14;
  rating.fills = [{ type: 'SOLID', color: colors['Warning/Base'].rgb }];
  header.appendChild(rating);

  ipoCard.appendChild(header);

  // Divider
  const divider1 = figma.createLine();
  divider1.resize(332, 0);
  divider1.strokes = [{ type: 'SOLID', color: colors['Gray/200'].rgb }];
  ipoCard.appendChild(divider1);

  // Price Section
  const priceSection = figma.createFrame();
  priceSection.layoutMode = 'HORIZONTAL';
  priceSection.layoutAlign = 'STRETCH';
  priceSection.itemSpacing = 24;

  const priceInfo = figma.createText();
  priceInfo.characters = "Price: ₹280-300\nLot Size: 50 shares\nMin Investment: ₹15,000";
  priceInfo.fontSize = 14;
  priceInfo.fontName = { family: "Inter", style: "Regular" };
  priceInfo.lineHeight = { value: 22, unit: 'PIXELS' };
  priceSection.appendChild(priceInfo);

  ipoCard.appendChild(priceSection);

  // Dates Section
  const dateSection = figma.createText();
  dateSection.characters = "📅 Opens: Jan 15 | Closes: Jan 17";
  dateSection.fontSize = 14;
  dateSection.fontName = { family: "Inter", style: "Medium" };
  ipoCard.appendChild(dateSection);

  // Divider
  const divider2 = divider1.clone();
  ipoCard.appendChild(divider2);

  // Subscription Section
  const subSection = figma.createFrame();
  subSection.layoutMode = 'VERTICAL';
  subSection.layoutAlign = 'STRETCH';
  subSection.itemSpacing = 8;

  const subHeader = figma.createFrame();
  subHeader.layoutMode = 'HORIZONTAL';
  subHeader.counterAxisAlignItems = 'CENTER';

  const subLabel = figma.createText();
  subLabel.characters = "Subscription Status";
  subLabel.fontSize = 14;
  subLabel.fontName = { family: "Inter", style: "Medium" };
  subLabel.layoutGrow = 1;
  subHeader.appendChild(subLabel);

  // Live badge
  const liveBadge = figma.createFrame();
  liveBadge.layoutMode = 'HORIZONTAL';
  liveBadge.paddingTop = 2;
  liveBadge.paddingBottom = 2;
  liveBadge.paddingLeft = 8;
  liveBadge.paddingRight = 8;
  liveBadge.cornerRadius = 9999;
  liveBadge.fills = [{ type: 'SOLID', color: colors['Success/Base'].rgb }];

  const liveText = figma.createText();
  liveText.characters = "LIVE";
  liveText.fontSize = 11;
  liveText.fontName = { family: "Inter", style: "Semi Bold" };
  liveText.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  liveBadge.appendChild(liveText);
  subHeader.appendChild(liveBadge);

  subSection.appendChild(subHeader);

  // Progress bar
  const progressBar = figma.createFrame();
  progressBar.resize(332, 24);
  progressBar.cornerRadius = 4;
  progressBar.fills = [{ type: 'SOLID', color: colors['Gray/300'].rgb }];

  const progressFill = figma.createFrame();
  progressFill.resize(76, 24);
  progressFill.cornerRadius = 4;
  progressFill.fills = [{ type: 'SOLID', color: colors['Success/Base'].rgb }];

  const progressText = figma.createText();
  progressText.characters = "2.3x";
  progressText.fontSize = 12;
  progressText.fontName = { family: "Inter", style: "Semi Bold" };
  progressText.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  progressText.x = 8;
  progressText.y = 4;
  progressFill.appendChild(progressText);

  progressBar.appendChild(progressFill);
  subSection.appendChild(progressBar);

  // Category stats
  const categoryStats = figma.createText();
  categoryStats.characters = "Retail: 3.2x | QIB: 1.8x | NII: 2.1x";
  categoryStats.fontSize = 13;
  categoryStats.fontName = { family: "Inter", style: "Regular" };
  categoryStats.fills = [{ type: 'SOLID', color: colors['Gray/600'].rgb }];
  subSection.appendChild(categoryStats);

  ipoCard.appendChild(subSection);

  // Divider
  const divider3 = divider1.clone();
  ipoCard.appendChild(divider3);

  // GMP Section
  const gmpSection = figma.createFrame();
  gmpSection.layoutMode = 'HORIZONTAL';
  gmpSection.layoutAlign = 'STRETCH';
  gmpSection.cornerRadius = 8;
  gmpSection.paddingTop = 12;
  gmpSection.paddingBottom = 12;
  gmpSection.paddingLeft = 16;
  gmpSection.paddingRight = 16;
  gmpSection.fills = [{ type: 'SOLID', color: colors['Warning/Light'].rgb }];

  const gmpText = figma.createText();
  gmpText.characters = "GMP: +₹45 (15%)";
  gmpText.fontSize = 14;
  gmpText.fontName = { family: "Inter", style: "Semi Bold" };
  gmpText.fills = [{ type: 'SOLID', color: colors['Success/Dark'].rgb }];
  gmpText.layoutGrow = 1;
  gmpSection.appendChild(gmpText);

  const expectedText = figma.createText();
  expectedText.characters = "Expected: ₹345";
  expectedText.fontSize = 14;
  expectedText.fontName = { family: "Inter", style: "Regular" };
  gmpSection.appendChild(expectedText);

  ipoCard.appendChild(gmpSection);

  // Divider
  const divider4 = divider1.clone();
  ipoCard.appendChild(divider4);

  // Action Buttons
  const actions = figma.createFrame();
  actions.layoutMode = 'HORIZONTAL';
  actions.layoutAlign = 'STRETCH';
  actions.itemSpacing = 8;

  const viewBtn = createSimpleButton("View Details", false);
  const trackBtn = createSimpleButton("Track", false);
  const applyBtn = createSimpleButton("Apply Now", true);

  actions.appendChild(viewBtn);
  actions.appendChild(trackBtn);
  actions.appendChild(applyBtn);

  ipoCard.appendChild(actions);
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function createSimpleButton(text: string, isPrimary: boolean): FrameNode {
  const btn = figma.createFrame();
  btn.layoutMode = 'HORIZONTAL';
  btn.primaryAxisAlignItems = 'CENTER';
  btn.counterAxisAlignItems = 'CENTER';
  btn.layoutGrow = 1;
  btn.paddingTop = 8;
  btn.paddingBottom = 8;
  btn.paddingLeft = 16;
  btn.paddingRight = 16;
  btn.cornerRadius = 6;

  if (isPrimary) {
    btn.fills = [{ type: 'SOLID', color: colors['Primary/500'].rgb }];
  } else {
    btn.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    btn.strokes = [{ type: 'SOLID', color: colors['Gray/300'].rgb }];
    btn.strokeWeight = 1;
  }

  const btnText = figma.createText();
  btnText.characters = text;
  btnText.fontSize = 14;
  btnText.fontName = { family: "Inter", style: "Semi Bold" };
  btnText.fills = [{
    type: 'SOLID',
    color: isPrimary ? { r: 1, g: 1, b: 1 } : colors['Gray/700'].rgb
  }];
  btnText.layoutGrow = 1;
  btnText.textAlignHorizontal = 'CENTER';

  btn.appendChild(btnText);
  return btn;
}

async function arrangeComponentsInGrid(componentSet: FrameNode) {
  const children = componentSet.children;
  const columns = 3;
  const spacing = 20;

  children.forEach((child, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    child.x = col * (child.width + spacing);
    child.y = row * (child.height + spacing);
  });

  // Resize component set to fit all variants
  const maxX = Math.max(...children.map(c => c.x + c.width));
  const maxY = Math.max(...children.map(c => c.y + c.height));
  componentSet.resize(maxX + spacing, maxY + spacing);
}

// Notify that plugin is ready
figma.notify('🚀 IPODhan Design System Generator Ready!');
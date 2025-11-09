# Dynamic Admin - Quick Reference Card
**Version**: 1.0 | **Date**: 2025-11-09 | **Print and Keep at Workstation**

---

## 🔗 Common URLs

| Task | URL Pattern | Example |
|------|-------------|---------|
| Dashboard | `/admin` | http://localhost:3000/admin |
| View IPO | `/admin/dynamic/ipos/{id}` | /admin/dynamic/ipos/abc123 |
| Edit IPO | Same as view | Click Edit button |
| Create IPO | `/admin/dynamic/ipos/new` | /admin/dynamic/ipos/new |
| IPO List | `/admin/dynamic/ipos/list` | Filter and search all IPOs |

---

## 🎨 Color Guide

### Validation Colors
| Color | Icon | Meaning | Can Save? |
|-------|------|---------|-----------|
| ⚪ No color | - | ✅ Valid data | Yes |
| 🟡 Yellow border | ⚠️ | ⚠️ Warning (unusual but allowed) | **Yes** |
| 🔴 Red border | ❌ | ❌ Error (must fix) | **No** |

### Relationship Card Colors
| Color | Icon | Status | What To Do |
|-------|------|--------|------------|
| 🟢 Green | ✓ | Has data | Click "View" to see records |
| 🟡 Yellow | ⚠️ | **Required** but missing | Click "+ Add" NOW |
| ⚪ Gray | ✗ | Optional, no data | Skip or add if available |
| 🔵 Blue | - | Current table | You are here |

---

## ✅ Required Relationships (Must Be GREEN)

| Relationship | When Required | Icon |
|--------------|---------------|------|
| 💰 Financial Data | **Always** | Must have |
| 📊 Subscriptions | For OPEN/CLOSED IPOs | Must have |
| 📄 Documents | **Always** | Must have |
| 🎯 Listing Performance | For LISTED IPOs | Must have |
| 📈 GMP Records | Never required | Optional |
| 🏢 Peer Companies | Never required | Optional |
| ⚓ Anchor Investors | Never required | Optional |
| ⭐ Reviews | Never required | Optional |

**Goal**: All yellow cards → green cards = 100% complete!

---

## 📝 Field Labels Decoder

### Common Fields

| You See | What It Means | Unit | Where |
|---------|---------------|------|-------|
| Price Band - Lower | Minimum offer price | **₹** before | Price |
| Price Band - Upper | Maximum offer price | **₹** before | Price |
| Lot Size | Min shares per application | shares after | Subscription |
| Minimum Investment | Lot × Price (auto-calc) | **₹** before | Subscription |
| Issue Size | Total capital to raise | **₹ Crores** | Size |
| P/E Ratio | Price to Earnings | x after | Financials |
| ROE | Return on Equity | **%** after | Financials |
| Debt-to-Equity | Leverage ratio | x after | Financials |
| QIB Subscription | Institutional demand | x after | Subscription |
| NII Subscription | HNI demand | x after | Subscription |
| Retail Subscription | Retail demand | x after | Subscription |

**Key**:
- **₹** appears BEFORE input box = Currency prefix
- **%**, **x**, **shares** appear AFTER input = Suffix units

---

## 🛡️ SEBI Compliance Quick Checks

### Price Band Limits
- **Mainboard**: ≤ 20% of floor price ✅
- **SME**: ≤ 40% of floor price ✅
- Example: Floor ₹100 → Cap ≤ ₹120 (mainboard)

### Minimum Application
- **Retail**: ₹10,000 to ₹15,000 ✅
- Calculate: Lot Size × Price
- Example: 125 shares × ₹100 = ₹12,500 ✅

### Quota Allocations
- **QIB**: 50% (mainboard)
- **NII**: ≥15% (mainboard)
- **Retail**: ≥35% (mainboard)

### Listing Timeline
- **Mainboard**: Within 6 working days of close
- **SME**: Within 12 working days

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Tab` | Move to next field |
| `Shift+Tab` | Move to previous field |
| `Esc` | Cancel/Close dialog |
| `Enter` | Submit (when on Save button) |

---

## 💡 Tooltip Usage

### When You See ℹ️ Icon

1. **Hover** over icon (don't click)
2. **Read** the tooltip that appears:
   - **Summary**: Quick description
   - **Details**: Full explanation
   - **Examples**: Real-world cases
   - **Regulation**: SEBI reference
   - **Link**: Click "View Full Text →"
3. **Learn**: Tooltips cite official regulations

**Pro Tip**: If unsure about a field, ALWAYS check the tooltip first!

---

## 🚨 Common Mistakes to Avoid

| ❌ Don't | ✅ Do Instead |
|----------|---------------|
| Ignore yellow warnings | Read warning, decide if intentional |
| Save with red errors | Fix all red errors first |
| Skip tooltips | Use tooltips for guidance |
| Forget to add required data | Check Related Data panel |
| Enter placeholder values | Enter real data or leave blank |
| Unlock protected fields casually | Only unlock if absolutely necessary |
| Edit JSON carelessly | Validate JSON syntax |

---

## 🆘 Getting Help

### Step-by-Step Help Process

1. **Check Tooltip** (ℹ️ icon)
   - Hover over field label
   - Read SEBI regulation
   - Check examples

2. **Check Field Description**
   - Gray text below label
   - Explains what to enter

3. **Check This Reference Card**
   - Field decoder
   - Validation colors
   - SEBI compliance

4. **Ask Supervisor**
   - Provide screenshot
   - Explain what you tried
   - Note the error message

5. **Report Bugs**
   - Email: [support email]
   - Slack: #admin-support
   - Include: URL, screenshot, steps

---

## 📊 Data Completeness Workflow

### Standard Process for New IPO

```
1. CREATE IPO RECORD
   ↓
2. CHECK RELATED DATA PANEL
   Completeness: 0/8 (0%)
   ↓
3. ADD REQUIRED DATA (Yellow Cards → Green)
   • Financial Data → GREEN ✓
   • Subscriptions → GREEN ✓
   • Documents → GREEN ✓
   • Listing Performance (if LISTED) → GREEN ✓
   ↓
4. ADD OPTIONAL DATA (if available)
   • GMP Records
   • Peer Companies
   • Anchor Investors
   ↓
5. VERIFY COMPLETENESS
   Target: 100% or all required GREEN
   ↓
6. FINAL CHECK
   • No red errors
   • Warnings reviewed
   • Required data complete
   ↓
7. SAVE & PUBLISH ✅
```

---

## 🔒 Field Protection

### When to Protect Fields

- ✅ After SEBI filing (regulatory data)
- ✅ After auditor verification
- ✅ Critical computed fields
- ✅ Historical data (don't change past)

### How to Protect/Unprotect

1. Find field with 🔒 icon button
2. **Protected**: Grayed out, can't edit
3. Click 🔒 to **unlock** → can edit
4. Make changes
5. Click 🔒 again to **protect** → locked

**Warning**: Only unlock if you know what you're doing!

---

## 📈 Quick Wins

### Efficiency Tips

**Use Browser Tabs**:
- Tab 1: IPO record (keep open)
- Tab 2: Add related data
- Tab 3: Reference another IPO
- Copy/paste between tabs ✅

**Use Search Effectively**:
- Type partial company name
- Type ticker symbol
- Filter by status/segment
- Results update live

**Use Related Data Panel**:
- At-a-glance completeness
- One-click navigation
- Auto-filtered views
- Quick "+ Add" buttons

---

## 📅 Daily Checklist

### Morning Routine
- [ ] Check for OPEN IPOs
- [ ] Verify subscription data updated
- [ ] Check for new listings today
- [ ] Update GMP if available

### Before Lunch
- [ ] Complete data entry from morning
- [ ] Verify all required data GREEN
- [ ] Fix any validation errors

### End of Day
- [ ] Save all work
- [ ] Verify no unsaved changes
- [ ] Check tomorrow's listings
- [ ] Note any issues for team

---

## 🎯 Success Criteria

**You're Doing It Right When**:
- ✅ Completeness panel shows 100%
- ✅ No red error borders
- ✅ All required cards are GREEN
- ✅ Protected fields have 🔒
- ✅ Tooltips used for guidance
- ✅ Data validates correctly
- ✅ No warnings ignored blindly

**You Need Help When**:
- ❌ Can't find a field
- ❌ Don't understand tooltip
- ❌ Error won't go away
- ❌ Completeness stuck at <100%
- ❌ Unsure if data is correct

---

**Need This Reference?**
- 📄 PDF: [Link to PDF version]
- 🖨️ Print: File → Print → A4 landscape
- 📱 Bookmark: /admin-quick-reference

**Version**: 1.0 | **Updated**: 2025-11-09 | **Feedback**: [email/slack]

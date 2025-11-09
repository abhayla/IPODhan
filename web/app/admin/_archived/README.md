# Archived Admin Components

**Date Archived**: 2025-11-09
**Phase**: Admin Consolidation - Week 2
**Reason**: Replaced by Dynamic Admin System

---

## ⚠️ DEPRECATION NOTICE

This directory contains **deprecated** admin interface components that have been replaced by the **Dynamic Admin** system.

**Do not use these components for new development.**

---

## 📂 Contents

### `/edit/[slug]/` - Traditional IPO Admin (DEPRECATED)
- **Status**: ❌ Deprecated as of 2025-11-09
- **Replacement**: `/admin/dynamic/ipos/[id]`
- **File Size**: 26,147 tokens (very large monolithic component)
- **Last Active**: 2025-11-08

**Features that were migrated**:
- ✅ IPO detail view and editing
- ✅ Field protection UI
- ✅ Related data tabs (Financial, Subscriptions, GMP, Documents)
- ✅ Objectives editor (JSON field in Dynamic Admin)
- ✅ Extraction results viewer integration

**Why it was deprecated**:
1. Monolithic component (26k+ tokens) - difficult to maintain
2. Duplicate field handling logic with Dynamic Admin
3. Custom validation scattered throughout code
4. Not self-extending (required code changes for schema updates)
5. Poor separation of concerns

---

## 🔄 Migration Path

### For Admin Users
**Old URL**: `/admin/edit/xyz-corporation-ipo`
**New URL**: `/admin/dynamic/ipos/{ipo-id}`

**How to find new URL**:
1. Go to Admin Dashboard (`/admin`)
2. Search for IPO by name
3. Click "Edit" button (now uses Dynamic Admin)

### For Developers
**Old Code**:
```tsx
<Link href={`/admin/edit/${ipo.slug}`}>
  Edit IPO
</Link>
```

**New Code**:
```tsx
<Link href={`/admin/dynamic/ipos/${ipo.id}`}>
  Edit IPO
</Link>
```

---

## 📚 Documentation References

**Dynamic Admin Documentation**:
- `docs/00-admin/ADMIN-USER-GUIDE-Day-3-4-Enhancements.md` - User guide
- `docs/00-admin/DAY-3-4-IMPLEMENTATION-SUMMARY.md` - Implementation details
- `docs/00-admin/TRADITIONAL-ADMIN-DEPRECATION-PLAN.md` - Deprecation plan

**Why Dynamic Admin is Better**:
1. **Self-extending**: Automatically adapts to schema changes
2. **Consistent UX**: All 16 tables use same interface
3. **Better validation**: Inline warnings vs errors, SEBI compliance
4. **User-friendly**: Field labels, tooltips with regulatory references
5. **Relationship navigation**: Data completeness at a glance
6. **Maintainable**: Smaller components, clear separation of concerns

---

## 🗑️ Deletion Plan

### Timeline
- **Week 1 (Current)**: Move to archive, update all links
- **Week 2-4**: Monitor for any issues, verify zero usage
- **Month 2**: Complete removal if no issues reported

### Before Deletion
- [ ] Verify zero traffic to archived routes
- [ ] Confirm all internal links updated
- [ ] Verify all tests passing with new paths
- [ ] Get final sign-off from product team

---

## 🚨 Emergency Fallback

If critical issues are discovered with Dynamic Admin:

1. **Restore Route**: Copy files back to `/app/admin/edit/`
2. **Revert Links**: Git revert link changes
3. **Notify Team**: Slack alert with issue details
4. **Investigation**: Debug Dynamic Admin issue
5. **Timeline**: Aim for same-day resolution

**Note**: This is a **last resort only**. Dynamic Admin has been thoroughly tested and provides superior functionality.

---

## 📞 Support

**Questions about archived files**:
- Check git history: `git log --follow web/app/admin/_archived/edit/[slug]/page.tsx`
- Review deprecation plan: `docs/00-admin/TRADITIONAL-ADMIN-DEPRECATION-PLAN.md`
- Contact: Development team lead

**Issues with Dynamic Admin**:
- Check user guide: `docs/00-admin/ADMIN-USER-GUIDE-Day-3-4-Enhancements.md`
- File bug report: Include steps to reproduce
- Contact: Admin support team

---

**Archive Maintained By**: IPODhan Development Team
**Last Updated**: 2025-11-09
**Next Review**: 2025-12-09 (1 month after archival)

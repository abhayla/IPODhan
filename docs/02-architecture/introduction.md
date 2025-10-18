# Introduction

This document outlines the complete fullstack architecture for **IPODhan**, including backend systems, frontend implementation, and their integration. It serves as the single source of truth for AI-driven development, ensuring consistency across the entire technology stack.

This unified approach combines what would traditionally be separate backend and frontend architecture documents, streamlining the development process for modern fullstack applications where these concerns are increasingly intertwined.

## Starter Template or Existing Project

**Status:** Existing Next.js project detected in `/web` directory

Based on analysis of the repository:
- **Current State:** A Next.js 14 project has been initialized with TypeScript, Tailwind CSS, and shadcn/ui
- **Existing Choices:**
  - Framework: Next.js 14 (App Router)
  - Language: TypeScript
  - Styling: Tailwind CSS
  - UI Components: shadcn/ui (Radix UI primitives)
  - Package Manager: npm

**Architectural Constraints from Existing Setup:**
- Must use Next.js App Router patterns (not Pages Router)
- Component structure follows shadcn/ui conventions
- Tailwind CSS for all styling (no CSS Modules or styled-components)
- TypeScript strict mode enabled

**What Can Be Modified:**
- State management solution (currently none selected)
- API architecture (REST vs tRPC vs GraphQL)
- Database ORM/query builder
- Authentication provider
- Testing framework
- Data fetching patterns

## Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2025-10-05 | 1.0 | Initial architecture document created from PRD, brief, and front-end spec | Winston (Architect) |
| 2025-10-05 | 1.1 | Documentation reconciliation: Updated tech stack (React Context, flexible email provider), added new data models (MarketHoliday, Registrar, PeerCompany, BrokerAffiliate, IPONews), enhanced GMP fields, added MVP phase markers throughout | Winston (Architect) |
| 2025-10-05 | 1.2 | Final MVP scope alignment: Moved Email Alerts and IPO News to Phase 2, confirmed full peer comparison metrics for MVP, clarified 4 core tools as MVP features | Winston (Architect) |

---

## Phase Legend

Throughout this document, features and components are marked with phase indicators:

- 🔵 **MVP** - Must be implemented for initial launch
- 🟢 **Phase 2** - Post-MVP enhancements (3-6 months after launch)
- 🟣 **Phase 3** - Future considerations (6+ months after launch)

Unmarked items are foundational infrastructure required for MVP.

---

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

IPODhan is a comprehensive IPO-focused platform for Indian retail investors. The project is currently in the design and requirements phase, with detailed specifications for building a web and mobile application that provides:
- Real-time IPO tracking (live, upcoming, closed IPOs)
- Grey Market Premium (GMP) monitoring
- Broker comparisons and demat account opening facilitation
- Investment tools and calculators
- Knowledge hub for IPO education

## Architecture and Technology Stack

### Proposed Technology Stack
- **Frontend**: React (Next.js) with Tailwind CSS for web, React Native for mobile
- **Backend**: Node.js + Express (Django as alternative)
- **Database**: PostgreSQL/MySQL for structured data, MongoDB for logs
- **AI Integration**: Grok API for semantic search and personalized recommendations
- **Cloud Infrastructure**: AWS/GCP/Vercel/Netlify
- **Analytics**: Google Analytics with custom tracking

### Key Integrations Required
- NSE/BSE/SEBI APIs for real-time IPO data
- Broker APIs (Zerodha, Dhan, Upstox) for demat account integration
- Payment integration via UPI for IPO applications
- Registrar APIs (Link Intime, KFintech) for allotment status

## Core Modules and Features

### 1. IPO Tracking Module
- Live, upcoming, and closed IPO listings
- Real-time subscription status updates
- GMP tracking with historical trends
- Allotment status checker
- Support for mainboard and SME IPOs

### 2. Broker Hub
- Broker comparison tables
- Direct demat account opening links
- Brokerage fee calculators
- In-app IPO application capabilities

### 3. Tools and Analytics
- ROI and allotment probability calculators
- Portfolio tracker
- IPO performance reports
- Educational resources and guides

### 4. User Features
- Personalized dashboards
- Custom alerts for IPO events
- AI-powered chatbot for queries
- Community forums

## Development Guidelines

### Performance Requirements
- Page load time: <2 seconds
- Support for 100,000 concurrent users during peak IPO periods
- Real-time data updates via WebSockets
- 99.9% uptime target

### Security and Compliance
- HTTPS encryption for all communications
- SEBI regulatory compliance for IPO content
- Privacy policy adherence for user data
- Transparent affiliate partnership disclosures
- KYC integration for demat services

### Data Management
- Real-time IPO data from NSE/BSE feeds
- Manual + automated GMP tracking
- Daily data backups
- Comprehensive error logging

## Project Status

The project is currently in the requirements and design phase. The repository contains:
- Detailed design requirement documents in `/docs/`
- Sitemap visualization images in `/img/`

Next steps include:
1. Wireframe development
2. UI/UX prototyping (Figma/Adobe XD)
3. Development environment setup
4. API integration planning
5. Database schema design
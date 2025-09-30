# IPODhan - Smart IPO Investment Platform 💹

IPODhan is a comprehensive IPO-focused platform for Indian retail investors, providing real-time tracking, analysis tools, and investment insights.

## 🚀 Features

- **Real-Time IPO Tracking**: Live, upcoming, and closed IPO listings
- **Grey Market Premium (GMP)**: Accurate GMP rates with historical trends
- **Broker Comparison**: Compare 15+ brokers for fees and features
- **Investment Tools**: Returns calculator, allotment checker, portfolio tracker
- **User Dashboard**: Personalized tracking and portfolio management
- **Smart Alerts**: Notifications for IPO events and status updates

## 🛠️ Technology Stack

### Frontend
- **Framework**: Next.js 14 with TypeScript
- **Styling**: Tailwind CSS
- **State Management**: React Context API
- **Real-time**: WebSocket integration

### Backend
- **Runtime**: Node.js with Express
- **Database**: PostgreSQL (production) / SQLite (development)
- **ORM**: Prisma
- **Authentication**: JWT
- **Caching**: Redis

### Infrastructure
- **Containerization**: Docker & Docker Compose
- **Reverse Proxy**: Nginx
- **Deployment**: AWS/GCP/Vercel ready

## 📁 Project Structure

```
IPODhan/
├── ipodhan-web/          # Next.js frontend application
│   ├── src/
│   │   ├── app/          # Next.js app router pages
│   │   ├── components/   # React components
│   │   ├── services/     # API and WebSocket services
│   │   └── utils/        # Utility functions
│   └── public/           # Static assets
│
├── ipodhan-backend/      # Express backend API
│   ├── src/
│   │   ├── controllers/  # Route controllers
│   │   ├── routes/       # API routes
│   │   ├── middleware/   # Express middleware
│   │   └── services/     # Business logic
│   └── prisma/           # Database schema
│
├── figma-plugin/         # Figma design system plugin
│   ├── code.ts           # Plugin logic
│   ├── ui.html           # Plugin UI
│   └── manifest.json     # Plugin configuration
│
└── docs/                 # Documentation

```

## 🚦 Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- Docker (optional)

### Local Development

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/ipodhan.git
cd ipodhan
```

2. **Setup Frontend**
```bash
cd ipodhan-web
npm install
npm run dev
```
Frontend runs on http://localhost:3000

3. **Setup Backend**
```bash
cd ipodhan-backend
npm install
npx prisma migrate dev
npm run dev
```
Backend runs on http://localhost:5000

4. **Access the application**
- Frontend: http://localhost:3000
- Backend API: http://localhost:5000/api
- Health Check: http://localhost:5000/health

### Using Docker

```bash
# Build and run all services
docker-compose up --build

# Run in background
docker-compose up -d

# Stop services
docker-compose down
```

## 📊 Database Setup

### Development (SQLite)
```bash
cd ipodhan-backend
npx prisma migrate dev
npx prisma studio  # Visual database browser
```

### Production (PostgreSQL)
Update DATABASE_URL in .env:
```
DATABASE_URL="postgresql://user:password@localhost:5432/ipodhan_db"
```

## 🎨 Figma Design System

### Installing the Plugin
1. Open Figma Desktop App
2. Go to Plugins → Development → Import plugin from manifest
3. Select `figma-plugin/manifest.json`
4. Run plugin to generate design system

### Generated Components
- 40+ Color Styles
- 20+ Typography Styles
- 6 Shadow Effects
- 5 Key Components (Button, Input, Card, Badge, IPO Card)

## 🔧 API Endpoints

### IPO Endpoints
- `GET /api/ipos` - Get all IPOs
- `GET /api/ipos/:id` - Get IPO details
- `GET /api/ipos/status/:status` - Get IPOs by status

### User Endpoints
- `POST /api/users/register` - Register new user
- `POST /api/users/login` - User login
- `GET /api/users/profile` - Get user profile

### GMP Endpoints
- `GET /api/gmp/latest` - Latest GMP for all IPOs
- `GET /api/gmp/history/:ipoId` - GMP history for specific IPO

### Broker Endpoints
- `GET /api/brokers` - Get all brokers
- `GET /api/brokers/:id` - Get broker details

## 🚀 Deployment

### Vercel (Frontend)
```bash
cd ipodhan-web
vercel --prod
```

### Railway/Render (Backend)
1. Connect GitHub repository
2. Set environment variables
3. Deploy with automatic builds

### AWS/GCP
Use provided Docker configuration:
```bash
docker-compose -f docker-compose.prod.yml up
```

## 📱 Features Roadmap

- [x] Basic IPO listing and tracking
- [x] User authentication
- [x] Returns calculator
- [x] Dashboard
- [ ] Mobile app (React Native)
- [ ] Push notifications
- [ ] AI-powered recommendations
- [ ] Social features
- [ ] Advanced analytics

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

## 📄 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- NSE/BSE for IPO data
- Figma for design tools
- Next.js and Express communities

## 📞 Support

For support, email support@ipodhan.com or create an issue in this repository.

---

**Made with ❤️ for Indian Investors**
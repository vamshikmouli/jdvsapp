# Jnana Deepika — School ERP

A comprehensive school management system for attendance and fee management, built with Next.js, Prisma, and PostgreSQL.

## Project Setup

### Prerequisites
- Node.js 18+ (we have 24.16.0)
- PostgreSQL 12+
- npm or yarn

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   - Copy `.env.local` (already created)
   - Update `DATABASE_URL` with your PostgreSQL connection string:
     ```
     DATABASE_URL="postgresql://user:password@localhost:5432/jnana_deepika"
     ```

3. **Set up the database:**
   ```bash
   npm run db:push
   ```

4. **Seed initial data:**
   ```bash
   npm run db:seed
   ```

5. **Start the development server:**
   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
jnana-deepika-app/
├── app/                      # Next.js App Router
│   ├── layout.tsx            # Root layout
│   ├── page.tsx              # Login page
│   ├── (admin)/              # Admin dashboard routes
│   ├── (parent)/             # Parent mobile routes
│   ├── api/                  # API routes
│   └── globals.css           # Global styles + design tokens
├── components/
│   ├── Icon.tsx              # Lucide icon wrapper
│   ├── Primitives.tsx        # Base components (Button, Card, Modal, etc.)
│   ├── layout/               # App shell components (Sidebar, TopBar)
│   └── screens/              # Feature screens (Students, Classes, etc.)
├── lib/
│   ├── db.ts                 # Prisma client singleton
│   ├── auth.ts               # Auth configuration (Next Auth)
│   ├── types.ts              # TypeScript definitions
│   └── utils.ts              # Utility functions
├── prisma/
│   ├── schema.prisma         # Database schema
│   └── seed.ts               # Database seeding
└── public/                   # Static assets
```

## Database Schema

The database includes:

- **Users & Auth:** User, Staff, Roles (ADMIN, TEACHER, ACCOUNTANT, PARENT)
- **Academic Structure:** SchoolClass, Section, Student
- **Attendance:** AttendanceSession, AttendanceRecord
- **Settings:** Global configuration (session times, etc.)

*Note: Fee-related models will be added in Phase 2.*

## Design System

### Colors
- **Primary:** Purple `#7C3AED`
- **Accent:** Marigold `#F2A516`
- **Neutrals:** Cool slate scale
- **Semantic:** Success (green), Warning (amber), Danger (red), Info (blue)

### Typography
- **Display:** Plus Jakarta Sans
- **Body:** Inter (with tabular numerals for tables)
- **Code/IDs:** JetBrains Mono

### Components
All base components are in `components/Primitives.tsx`:
- Button
- Card
- StatCard
- Chip
- Modal
- Field / Input / Select
- PageHeader
- EmptyState
- Avatar

## Development Workflow

### Create a new feature screen:
1. Create a file in `components/screens/FeatureName.tsx`
2. Import Primitives: `import { Button, Card, PageHeader, ... } from '@/components/Primitives'`
3. Build the UI using design tokens (Tailwind classes + CSS variables)

### Add a new database model:
1. Update `prisma/schema.prisma`
2. Run: `npm run db:push`
3. Update seed if needed: `prisma/seed.ts`

### API endpoints:
- Create files in `app/api/[resource]/route.ts`
- Use Prisma client: `import { prisma } from '@/lib/db'`
- Implement role-based access control

## Build & Deployment

### Build for production:
```bash
npm run build
npm start
```

### Deploy to Vercel:
```bash
vercel
```

## Notes

### Phase 1 (Current)
- ✅ Scaffold Next.js + Prisma + PostgreSQL
- ✅ Design tokens & Primitives
- ✅ Database schema (non-fee)
- ⏳ Auth & roles
- ⏳ App shell (Sidebar, TopBar)
- ⏳ CRUD: Students, Classes, Staff
- ⏳ Attendance
- ⏳ Dashboard
- ⏳ Parent mobile

### Phase 2 (Later)
- Fee structure & management
- Fee collection & receipts
- Counter billing
- Payment processing

## Resources

- Design handoff: `../design_handoff_jnana_deepika/`
- Prototype: `../design_handoff_jnana_deepika/design_reference/ui_kits/`
- Data model: `../design_handoff_jnana_deepika/DATA_MODEL.md`
- API spec: `../design_handoff_jnana_deepika/API.md`

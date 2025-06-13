# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

- **Dev server**: `npm run dev` - Start Vite development server with HMR
- **Build**: `npm run build` - TypeScript compilation + Vite production build
- **Lint**: `npm run lint` - Run ESLint on the codebase
- **Preview**: `npm run preview` - Preview production build locally

## Architecture

This is a React + TypeScript + Vite application that renders a 3D go-kart race track using Three.js and React Three Fiber.

### Key Technologies
- **React Three Fiber**: React renderer for Three.js, handles 3D scene management
- **Three.js**: Core 3D graphics library for WebGL rendering
- **@react-three/drei**: Helper components and utilities for R3F
- **Vite**: Build tool providing fast HMR and optimized bundling

### Application Structure
- **src/App.tsx**: Root component that renders the RaceTrack
- **src/components/RaceTrack.tsx**: Main 3D scene component containing:
  - Canvas setup with camera positioning and lighting
  - Track component that generates curved race track geometry using CatmullRomCurve3
  - Procedural track boundaries using inner/outer barrier points
  - OrbitControls for 3D navigation

### 3D Scene Architecture
The race track is built using mathematical curves:
- CatmullRomCurve3 defines the main track path through predefined control points
- Track geometry uses TubeGeometry for the racing surface
- Barrier placement calculated by finding perpendicular vectors to track direction
- Scene includes ground plane, ambient/directional lighting, and floating title text

### TypeScript Configuration
Uses multiple tsconfig files for different contexts:
- `tsconfig.json`: Base configuration with references
- `tsconfig.app.json`: Application code compilation settings
- `tsconfig.node.json`: Node.js/build tool configuration
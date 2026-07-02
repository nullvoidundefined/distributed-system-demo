import { jsx as _jsx } from "react/jsx-runtime";
/** SPA entry: mounts the App and imports global styles. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles/global.scss';
createRoot(document.getElementById('root')).render(_jsx(StrictMode, { children: _jsx(App, {}) }));

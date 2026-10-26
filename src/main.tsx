import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/golos-text';
import '@fontsource-variable/geologica';
import App from './App';
import './styles.css';
import './responsive.css';
import './design-refinement.css';
import './atelier.css';
import './cabinet-v4.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

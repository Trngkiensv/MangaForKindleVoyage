import React from 'react';
import ReactDOM from 'react-dom';
import 'whatwg-fetch';
import App from './App.tsx';
import './index.css';

// React 17 deliberately uses ReactDOM.render for compatibility with older
// WebKit browsers such as the Kindle Voyage experimental browser.
ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root'),
);

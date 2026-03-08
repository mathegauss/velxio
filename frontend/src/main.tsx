import { createRoot } from 'react-dom/client'
import './index.css'
import './components/components-wokwi/IC74HC595'
import './components/components-wokwi/LogicGateElements'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <App />,
)

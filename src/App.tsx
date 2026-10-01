import "./App.css"
import { AppProviders } from "./app/providers/AppProviders"
import { LockGate } from "./app/LockGate"

function App() {
  return <AppProviders><LockGate /></AppProviders>
}

export default App

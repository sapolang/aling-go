import { Button } from '@/components/ui/button'
import { useThemeStore } from '@/stores/themeStore'
import { Sun, Moon } from 'lucide-react'

export function ThemeToggle() {
  const { dark, toggle } = useThemeStore()
  return (
    <Button variant="ghost" size="icon" onClick={toggle}>
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  )
}

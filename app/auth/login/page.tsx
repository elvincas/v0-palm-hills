"use client"

import type React from "react"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useRouter } from "next/navigation"
import { useState } from "react"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    console.log("[v0] Login attempt with:", email)
    const supabase = createClient()
    console.log("[v0] Supabase client created:", supabase ? "OK" : "FAILED")
    setIsLoading(true)
    setError(null)

    try {
      console.log("[v0] Attempting signInWithPassword...")
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      console.log("[v0] SignIn response error:", error)
      if (error) throw error
      console.log("[v0] Login successful, redirecting...")
      router.push("/")
      router.refresh()
    } catch (error: unknown) {
      console.log("[v0] Login error caught:", error)
      setError(error instanceof Error ? error.message : "Ocurrió un error")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-background p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <img
            src="/logo.png"
            alt="Palm Hills"
            className="h-16 w-16 object-contain"
          />
          <h1 className="text-xl font-bold text-foreground text-balance">Palm Hills</h1>
          <p className="text-sm text-muted-foreground">Beauty &amp; Health</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Iniciar sesión</CardTitle>
            <CardDescription>Ingresa tus datos para acceder al sistema</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin}>
              <div className="flex flex-col gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="email">Correo electrónico</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="correo@ejemplo.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="password">Contraseña</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Ingresando..." : "Iniciar sesión"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

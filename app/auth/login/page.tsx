"use client"

import type React from "react"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
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
    
    if (!email || !password) {
      setError("Please fill in all fields")
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      console.log("[v0] Creating Supabase client...")
      const supabase = createClient()
      console.log("[v0] Supabase client created successfully")
      
      console.log("[v0] Attempting signInWithPassword with email:", email)
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      
      console.log("[v0] SignIn response:", { data, error })
      
      if (error) {
        console.error("[v0] Auth error:", error.message, error.status)
        throw error
      }
      
      if (!data?.session) {
        console.error("[v0] No session returned after login")
        throw new Error("Couldn't create the session. Please try again.")
      }
      
      console.log("[v0] Login successful, redirecting...")
      router.push("/")
      router.refresh()
    } catch (error: unknown) {
      console.error("[v0] Login error:", error)
      
      let errorMessage = "An error occurred while signing in"

      if (error instanceof Error) {
        errorMessage = error.message

        // More specific error messages
        if (error.message.includes("Invalid login credentials")) {
          errorMessage = "Incorrect email or password"
        } else if (error.message.includes("Email not confirmed")) {
          errorMessage = "Please confirm your email before signing in"
        } else if (error.message.includes("User not found")) {
          errorMessage = "This email is not registered"
        } else if (error.message.includes("Password")) {
          errorMessage = "The password is incorrect"
        }
      }
      
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-gradient-to-br from-green-50 via-background to-amber-50 p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <div className="relative group">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-amber-200/10 rounded-full blur-xl group-hover:blur-2xl transition-all duration-300 opacity-0 group-hover:opacity-100"></div>
            <div className="relative rounded-3xl bg-white/40 backdrop-blur-2xl border border-white/60 p-4 shadow-2xl">
              <img
                src="/logo.png"
                alt="Palm Hills"
                className="h-16 w-16 object-contain"
              />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground text-balance">Palm Hills</h1>
            <p className="text-sm text-muted-foreground">Beauty & Health</p>
          </div>
        </div>
        <div className="rounded-3xl bg-white/40 backdrop-blur-2xl border border-white/60 shadow-2xl overflow-hidden">
          <div className="px-6 py-8 md:px-8 md:py-10">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-foreground">Sign In</h2>
              <p className="text-sm text-muted-foreground mt-1">Enter your details to access the system</p>
            </div>
            <form onSubmit={handleLogin}>
              <div className="flex flex-col gap-5">
                {error && (
                  <div className="rounded-xl bg-red-50/80 backdrop-blur-sm border border-red-200/60 p-3.5 flex gap-3">
                    <div className="text-red-600 font-bold text-lg flex-shrink-0">!</div>
                    <p className="text-sm text-red-700 font-medium">{error}</p>
                  </div>
                )}
                <div className="grid gap-2">
                  <Label htmlFor="email" className="text-sm font-medium text-foreground">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="email@example.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="rounded-xl bg-white/50 backdrop-blur-sm border border-white/40 focus:border-primary/40 focus:bg-white/60 transition-all placeholder:text-muted-foreground/50"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="password" className="text-sm font-medium text-foreground">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="rounded-xl bg-white/50 backdrop-blur-sm border border-white/40 focus:border-primary/40 focus:bg-white/60 transition-all"
                  />
                </div>
                <Button 
                  type="submit" 
                  className="w-full mt-2 rounded-xl bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 text-white font-semibold shadow-lg transition-all duration-300 h-11" 
                  disabled={isLoading}
                >
                  {isLoading ? "Signing in..." : "Sign In"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}

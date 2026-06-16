import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Initialize Supabase Admin client with service role key
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)

export async function POST(request: Request) {
  try {
    const { email, password, action } = await request.json()

    // Validate email for all actions
    if (!email) {
      return NextResponse.json(
        { error: 'El correo electrónico es requerido' },
        { status: 400 }
      )
    }

    // Validate password only for create and resetPassword actions
    if ((action === 'create' || action === 'resetPassword') && !password) {
      return NextResponse.json(
        { error: 'La contraseña es requerida' },
        { status: 400 }
      )
    }

    if (action === 'create') {
      // Create new user with admin API
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })

      if (error) {
        let errorMessage = error.message
        if (error.message?.includes('already exists')) {
          errorMessage = 'El correo ya está registrado'
        }
        return NextResponse.json(
          { error: errorMessage },
          { status: 400 }
        )
      }

      return NextResponse.json(
        { user: data.user, message: 'Usuario creado exitosamente' },
        { status: 201 }
      )
    }

    if (action === 'resetPassword') {
      // Reset user password - need to get user ID first by listing users
      const { data: allUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers()
      
      if (listError) {
        return NextResponse.json(
          { error: 'Error al obtener usuarios' },
          { status: 400 }
        )
      }

      // Find user by email
      const userToUpdate = allUsers.users.find((u) => u.email === email)
      if (!userToUpdate) {
        return NextResponse.json(
          { error: 'Usuario no encontrado' },
          { status: 404 }
        )
      }

      // Reset password by user ID
      const { error } = await supabaseAdmin.auth.admin.updateUserById(
        userToUpdate.id,
        { password }
      )

      if (error) {
        return NextResponse.json(
          { error: 'Error al cambiar la contraseña' },
          { status: 400 }
        )
      }

      return NextResponse.json(
        { message: 'Contraseña cambiada exitosamente' },
        { status: 200 }
      )
    }

    if (action === 'delete') {
      // Delete user - need to get user ID first by listing users
      const { data: allUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers()
      
      if (listError) {
        return NextResponse.json(
          { error: 'Error al obtener usuarios' },
          { status: 400 }
        )
      }

      // Find user by email
      const userToDelete = allUsers.users.find((u) => u.email === email)
      if (!userToDelete) {
        return NextResponse.json(
          { error: 'Usuario no encontrado' },
          { status: 404 }
        )
      }

      // Delete user by ID
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userToDelete.id)

      if (error) {
        console.error("[v0] Delete user error:", error)
        let errorMessage = 'Error al eliminar el usuario'
        
        // Errores específicos de Supabase en español
        if (error.message?.includes('Cannot delete user with an active session')) {
          errorMessage = 'No se puede eliminar un usuario con una sesión activa. Cierra su sesión primero o espera a que expire.'
        } else if (error.message?.includes('Invalid user_id')) {
          errorMessage = 'ID de usuario inválido'
        } else if (error.message?.includes('Unauthorized')) {
          errorMessage = 'No tienes permisos para eliminar este usuario'
        }
        
        return NextResponse.json(
          { error: errorMessage, details: error.message },
          { status: 400 }
        )
      }

      return NextResponse.json(
        { message: 'Usuario eliminado exitosamente' },
        { status: 200 }
      )
    }

    return NextResponse.json(
      { error: 'Acción inválida' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Admin API error:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

// GET: List all users
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers()

    if (error) {
      return NextResponse.json(
        { error: 'Error al obtener usuarios' },
        { status: 400 }
      )
    }

    // Return only safe user info (no passwords)
    const safeUsers = (data.users || []).map((user) => ({
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at,
    }))

    return NextResponse.json({ users: safeUsers })
  } catch (error) {
    console.error('Admin API error:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

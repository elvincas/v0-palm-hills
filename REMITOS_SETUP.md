# Remitos (Castillo Pickup Receipts) Setup

## Overview
The remitos system is now integrated to automatically track Castillo warehouse pickups. When you complete picking with Castillo items, a **Remito** (pickup receipt) is automatically generated.

## What's New

### 1. **Automatic Remito Generation**
- After picking completes with Castillo items, a remito is automatically created
- Remitos are numbered starting from **5001**
- Separate from invoices which start from **1001**

### 2. **Dashboard Section**
- New "Castillo Pickups Pending" section shows all unsent remitos
- Quick "Mark Sent" button to track delivery status
- Shows: Client name, remito #, order #, pickup date

### 3. **Mobile UI Fix**
- Fixed button visibility issue when app is installed on iPhone home screen
- Increased bottom padding to ensure all buttons are visible

## Setup Instructions

### Step 1: Create the Remitos Table in Supabase

1. Go to your **Supabase Dashboard**
2. Click on **SQL Editor** (left sidebar)
3. Click **New Query**
4. Copy and paste the contents from `migrations/remitos_table.sql`
5. Click **Run**

The script will:
- ✓ Create `remitos` table with all necessary fields
- ✓ Add indexes for fast lookups by order, client, date
- ✓ Create automatic timestamp triggers
- ✓ Set up proper constraints

### Step 2: Verify Table Creation

In Supabase:
1. Go to **Table Editor** (left sidebar)
2. You should see a new `remitos` table in the list
3. Check the columns match the SQL script

### Step 3: Test the Feature

1. Create a new order with **Castillo** items
2. Go to **Orders** tab and start picking
3. After completing the picking, a remito should be auto-generated
4. Check the **Dashboard** → "Castillo Pickups Pending" section
5. You'll see the new remito with a "Mark Sent" button

## Table Structure

```sql
remitos (
  id UUID - Unique identifier
  num INTEGER - Remito number (5001+)
  orden_id UUID - Link to source order
  orden_num INTEGER - Order number for reference
  cli TEXT - Client name
  fecha TEXT - Pickup date
  lineas JSONB - Array of picked items with details
  enviado BOOLEAN - Whether remito was sent to client
  fecha_envio TEXT - Date remito was marked as sent
  total DECIMAL - Total value of items
  created_at TIMESTAMPTZ - Automatic timestamp
  updated_at TIMESTAMPTZ - Automatic timestamp
)
```

## How It Works

### When Picking Completes:
1. Invoice is generated with ALL items (Palm Hills + Castillo)
2. **Remito is ONLY generated if Castillo items were picked**
3. Remito contains ONLY the Castillo items (for your records)
4. Remito number is separate from invoice number

### Tracking Pickups:
1. Remito appears in "Castillo Pickups Pending" on Dashboard
2. Use "Mark Sent" button when you confirm delivery to inventory person
3. Remito status changes to "sent" with timestamp
4. Closed remitos stay in system for audit trail

## Why Two Documents?

- **Invoice** → What was billed to the customer (all items)
- **Remito** → What you physically took from Castillo (Castillo items only, for your record)

This way you have:
✓ Billing proof (invoice)  
✓ Pickup proof for Castillo warehouse person (remito)  
✓ Inventory tracking (remito marks what left Castillo)

## Support

If you need to:
- Delete old test remitos: Use Supabase Table Editor → delete rows from `remitos` table
- See all remitos (including sent): Check the database directly (not in UI yet)
- Troubleshoot: Check browser console for errors, or check Supabase activity logs

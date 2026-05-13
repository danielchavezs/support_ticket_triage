export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      dedup_signatures: {
        Row: {
          canonical_ticket_id: string
          created_at: string
          id: string
          normalized_signature: string
          org_id: string
        }
        Insert: {
          canonical_ticket_id: string
          created_at?: string
          id?: string
          normalized_signature: string
          org_id: string
        }
        Update: {
          canonical_ticket_id?: string
          created_at?: string
          id?: string
          normalized_signature?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dedup_signatures_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dedup_signatures_ticket_org_fk"
            columns: ["canonical_ticket_id", "org_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      orgs: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      ticket_events: {
        Row: {
          created_at: string
          event_type: Database["public"]["Enums"]["ticket_event_type"]
          id: string
          org_id: string
          payload: Json
          ticket_id: string
        }
        Insert: {
          created_at?: string
          event_type: Database["public"]["Enums"]["ticket_event_type"]
          id?: string
          org_id: string
          payload?: Json
          ticket_id: string
        }
        Update: {
          created_at?: string
          event_type?: Database["public"]["Enums"]["ticket_event_type"]
          id?: string
          org_id?: string
          payload?: Json
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_events_ticket_org_fk"
            columns: ["ticket_id", "org_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      tickets: {
        Row: {
          confidence: number | null
          created_at: string
          customer_facing_summary: string | null
          dedup_signature: string | null
          deleted_at: string | null
          description: string
          description_embedding: string | null
          duplicate_of: string | null
          id: string
          linear_issue_id: string | null
          org_id: string
          priority: Database["public"]["Enums"]["ticket_priority"] | null
          severity: Database["public"]["Enums"]["ticket_severity"] | null
          source_kind: Database["public"]["Enums"]["ticket_source_kind"]
          status: Database["public"]["Enums"]["ticket_status"]
          subject: string
          suggested_reply: string | null
          triage_error: string | null
          type: Database["public"]["Enums"]["ticket_type"] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          customer_facing_summary?: string | null
          dedup_signature?: string | null
          deleted_at?: string | null
          description: string
          description_embedding?: string | null
          duplicate_of?: string | null
          id?: string
          linear_issue_id?: string | null
          org_id: string
          priority?: Database["public"]["Enums"]["ticket_priority"] | null
          severity?: Database["public"]["Enums"]["ticket_severity"] | null
          source_kind: Database["public"]["Enums"]["ticket_source_kind"]
          status?: Database["public"]["Enums"]["ticket_status"]
          subject: string
          suggested_reply?: string | null
          triage_error?: string | null
          type?: Database["public"]["Enums"]["ticket_type"] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          customer_facing_summary?: string | null
          dedup_signature?: string | null
          deleted_at?: string | null
          description?: string
          description_embedding?: string | null
          duplicate_of?: string | null
          id?: string
          linear_issue_id?: string | null
          org_id?: string
          priority?: Database["public"]["Enums"]["ticket_priority"] | null
          severity?: Database["public"]["Enums"]["ticket_severity"] | null
          source_kind?: Database["public"]["Enums"]["ticket_source_kind"]
          status?: Database["public"]["Enums"]["ticket_status"]
          subject?: string
          suggested_reply?: string | null
          triage_error?: string | null
          type?: Database["public"]["Enums"]["ticket_type"] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_duplicate_org_fk"
            columns: ["duplicate_of", "org_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "tickets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_user_org_fk"
            columns: ["user_id", "org_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          deleted_at: string | null
          display_name: string | null
          email: string
          id: string
          org_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          email: string
          id?: string
          org_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          email?: string
          id?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      ticket_event_type:
        | "received"
        | "triaged"
        | "deduplicated"
        | "pushed_to_linear"
        | "status_changed"
        | "email_sent"
        | "failed"
      ticket_priority: "P1" | "P2" | "P3" | "P4"
      ticket_severity: "blocker" | "major" | "minor" | "trivial"
      ticket_source_kind: "in_app" | "aip_monitoring"
      ticket_status:
        | "received"
        | "triaged"
        | "duplicate"
        | "pushed_to_linear"
        | "failed"
        | "closed"
      ticket_type: "bug" | "feature" | "improvement" | "question" | "incident"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      ticket_event_type: [
        "received",
        "triaged",
        "deduplicated",
        "pushed_to_linear",
        "status_changed",
        "email_sent",
        "failed",
      ],
      ticket_priority: ["P1", "P2", "P3", "P4"],
      ticket_severity: ["blocker", "major", "minor", "trivial"],
      ticket_source_kind: ["in_app", "aip_monitoring"],
      ticket_status: [
        "received",
        "triaged",
        "duplicate",
        "pushed_to_linear",
        "failed",
        "closed",
      ],
      ticket_type: ["bug", "feature", "improvement", "question", "incident"],
    },
  },
} as const

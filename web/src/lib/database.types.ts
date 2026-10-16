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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      active_sessions: {
        Row: {
          bytes_in: number
          bytes_out: number
          code: string
          created_at: string
          id: string
          ip_address: string | null
          mac_address: string
          router_id: string
          tenant_id: string
          updated_at: string
          uptime_seconds: number
          voucher_id: string | null
        }
        Insert: {
          bytes_in?: number
          bytes_out?: number
          code: string
          created_at?: string
          id?: string
          ip_address?: string | null
          mac_address?: string
          router_id: string
          tenant_id: string
          updated_at?: string
          uptime_seconds?: number
          voucher_id?: string | null
        }
        Update: {
          bytes_in?: number
          bytes_out?: number
          code?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          mac_address?: string
          router_id?: string
          tenant_id?: string
          updated_at?: string
          uptime_seconds?: number
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "active_sessions_router_id_fkey"
            columns: ["router_id"]
            isOneToOne: false
            referencedRelation: "routers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "active_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "active_sessions_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_status: {
        Row: {
          hostname: string
          id: string
          job_types: string[]
          lan_addresses: string[]
          last_seen_at: string
          started_at: string
          version: string | null
        }
        Insert: {
          hostname: string
          id: string
          job_types?: string[]
          lan_addresses?: string[]
          last_seen_at?: string
          started_at?: string
          version?: string | null
        }
        Update: {
          hostname?: string
          id?: string
          job_types?: string[]
          lan_addresses?: string[]
          last_seen_at?: string
          started_at?: string
          version?: string | null
        }
        Relationships: []
      }
      alert_settings: {
        Row: {
          link_code: string | null
          link_code_expires_at: string | null
          low_stock_threshold: number
          notify_low_stock: boolean
          notify_offline: boolean
          notify_payments: boolean
          notify_push: boolean
          telegram_chat_id: string | null
          telegram_chat_title: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          link_code?: string | null
          link_code_expires_at?: string | null
          low_stock_threshold?: number
          notify_low_stock?: boolean
          notify_offline?: boolean
          notify_payments?: boolean
          notify_push?: boolean
          telegram_chat_id?: string | null
          telegram_chat_title?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          link_code?: string | null
          link_code_expires_at?: string | null
          low_stock_threshold?: number
          notify_low_stock?: boolean
          notify_offline?: boolean
          notify_payments?: boolean
          notify_push?: boolean
          telegram_chat_id?: string | null
          telegram_chat_title?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          body: string
          created_at: string
          id: string
          key: string
          kind: string
          resolved_at: string | null
          router_id: string | null
          send_attempts: number
          send_error: string | null
          sent_at: string | null
          site_id: string | null
          tenant_id: string
          title: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          key: string
          kind: string
          resolved_at?: string | null
          router_id?: string | null
          send_attempts?: number
          send_error?: string | null
          sent_at?: string | null
          site_id?: string | null
          tenant_id: string
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          key?: string
          kind?: string
          resolved_at?: string | null
          router_id?: string | null
          send_attempts?: number
          send_error?: string | null
          sent_at?: string | null
          site_id?: string | null
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_router_id_fkey"
            columns: ["router_id"]
            isOneToOne: false
            referencedRelation: "routers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          details: Json
          id: string
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json
          id?: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json
          id?: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_handovers: {
        Row: {
          amount_ssp: number
          id: string
          note: string | null
          received_at: string
          received_by: string
          seller_id: string
          site_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_ssp: number
          id?: string
          note?: string | null
          received_at?: string
          received_by: string
          seller_id: string
          site_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_ssp?: number
          id?: string
          note?: string | null
          received_at?: string
          received_by?: string
          seller_id?: string
          site_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_handovers_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_handovers_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_handovers_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_handovers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount_ssp: number
          category: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          site_id: string | null
          spent_on: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount_ssp: number
          category: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          site_id?: string | null
          spent_on: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount_ssp?: number
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          site_id?: string | null
          spent_on?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_ssp: number
          confirmed_by: string | null
          created_at: string
          customer_ref: string | null
          customer_ref_at: string | null
          due_at: string
          id: string
          number: string
          paid_at: string | null
          paid_ref: string | null
          period_end: string
          period_start: string
          price_per_router_ssp: number
          routers: number
          status: string
          tenant_id: string
        }
        Insert: {
          amount_ssp: number
          confirmed_by?: string | null
          created_at?: string
          customer_ref?: string | null
          customer_ref_at?: string | null
          due_at: string
          id?: string
          number: string
          paid_at?: string | null
          paid_ref?: string | null
          period_end: string
          period_start: string
          price_per_router_ssp: number
          routers: number
          status?: string
          tenant_id: string
        }
        Update: {
          amount_ssp?: number
          confirmed_by?: string | null
          created_at?: string
          customer_ref?: string | null
          customer_ref_at?: string | null
          due_at?: string
          id?: string
          number?: string
          paid_at?: string | null
          paid_ref?: string | null
          period_end?: string
          period_start?: string
          price_per_router_ssp?: number
          routers?: number
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_requests: {
        Row: {
          amount_ssp: number
          claim_token_hash: string
          client_ip: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          phone: string
          plan_id: string
          provider: string
          reject_reason: string | null
          sale_id: string | null
          site_id: string
          status: string
          tenant_id: string
          txn_ref: string
          voucher_id: string | null
        }
        Insert: {
          amount_ssp: number
          claim_token_hash: string
          client_ip?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          phone: string
          plan_id: string
          provider: string
          reject_reason?: string | null
          sale_id?: string | null
          site_id: string
          status?: string
          tenant_id: string
          txn_ref: string
          voucher_id?: string | null
        }
        Update: {
          amount_ssp?: number
          claim_token_hash?: string
          client_ip?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          phone?: string
          plan_id?: string
          provider?: string
          reject_reason?: string | null
          sale_id?: string | null
          site_id?: string
          status?: string
          tenant_id?: string
          txn_ref?: string
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_requests_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_requests_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_requests_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_requests_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_routers: {
        Row: {
          created_at: string
          managed: boolean
          plan_id: string
          profile_name: string
          router_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          managed?: boolean
          plan_id: string
          profile_name: string
          router_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          managed?: boolean
          plan_id?: string
          profile_name?: string
          router_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_routers_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_routers_router_id_fkey"
            columns: ["router_id"]
            isOneToOne: false
            referencedRelation: "routers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_routers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          color: string
          created_at: string
          data_limit_mb: number | null
          id: string
          is_active: boolean
          name: string
          price_ssp: number
          rate_limit: string | null
          router_profile_name: string
          shared_users: number
          tenant_id: string
          uptime_seconds: number
          validity_seconds: number | null
        }
        Insert: {
          color?: string
          created_at?: string
          data_limit_mb?: number | null
          id?: string
          is_active?: boolean
          name: string
          price_ssp: number
          rate_limit?: string | null
          router_profile_name: string
          shared_users?: number
          tenant_id: string
          uptime_seconds: number
          validity_seconds?: number | null
        }
        Update: {
          color?: string
          created_at?: string
          data_limit_mb?: number | null
          id?: string
          is_active?: boolean
          name?: string
          price_ssp?: number
          rate_limit?: string | null
          router_profile_name?: string
          shared_users?: number
          tenant_id?: string
          uptime_seconds?: number
          validity_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "plans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          acting_tenant_id: string | null
          acting_until: string | null
          created_at: string
          user_id: string
        }
        Insert: {
          acting_tenant_id?: string | null
          acting_until?: string | null
          created_at?: string
          user_id: string
        }
        Update: {
          acting_tenant_id?: string | null
          acting_until?: string | null
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_admins_acting_tenant_id_fkey"
            columns: ["acting_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_configs: {
        Row: {
          installed_at: string | null
          installed_dir: string | null
          previous_dir: string | null
          router_id: string
          server_profile: string | null
          settings: Json
          template: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          installed_at?: string | null
          installed_dir?: string | null
          previous_dir?: string | null
          router_id: string
          server_profile?: string | null
          settings?: Json
          template?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          installed_at?: string | null
          installed_dir?: string | null
          previous_dir?: string | null
          router_id?: string
          server_profile?: string | null
          settings?: Json
          template?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_configs_router_id_fkey"
            columns: ["router_id"]
            isOneToOne: true
            referencedRelation: "routers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_configs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          commission_pct: number
          created_at: string
          credit_limit_ssp: number | null
          full_name: string
          id: string
          is_active: boolean
          role: string
          site_id: string | null
          tenant_id: string
        }
        Insert: {
          commission_pct?: number
          created_at?: string
          credit_limit_ssp?: number | null
          full_name: string
          id: string
          is_active?: boolean
          role: string
          site_id?: string | null
          tenant_id: string
        }
        Update: {
          commission_pct?: number
          created_at?: string
          credit_limit_ssp?: number | null
          full_name?: string
          id?: string
          is_active?: boolean
          role?: string
          site_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      router_jobs: {
        Row: {
          attempts: number
          created_at: string
          created_by: string | null
          finished_at: string | null
          id: string
          payload: Json
          result: Json | null
          router_id: string | null
          started_at: string | null
          status: string
          tenant_id: string
          type: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          id?: string
          payload?: Json
          result?: Json | null
          router_id?: string | null
          started_at?: string | null
          status?: string
          tenant_id: string
          type: string
        }
        Update: {
          attempts?: number
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          id?: string
          payload?: Json
          result?: Json | null
          router_id?: string | null
          started_at?: string | null
          status?: string
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "router_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "router_jobs_router_id_fkey"
            columns: ["router_id"]
            isOneToOne: false
            referencedRelation: "routers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "router_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      router_logins: {
        Row: {
          comment: string | null
          first_login_at: string | null
          first_login_known: boolean
          first_seen_at: string
          id: string
          last_seen_at: string | null
          plan_id: string | null
          price_ssp: number | null
          profile: string | null
          router_id: string
          site_id: string
          tenant_id: string
          used: boolean
          username: string
        }
        Insert: {
          comment?: string | null
          first_login_at?: string | null
          first_login_known?: boolean
          first_seen_at?: string
          id?: string
          last_seen_at?: string | null
          plan_id?: string | null
          price_ssp?: number | null
          profile?: string | null
          router_id: string
          site_id: string
          tenant_id: string
          used?: boolean
          username: string
        }
        Update: {
          comment?: string | null
          first_login_at?: string | null
          first_login_known?: boolean
          first_seen_at?: string
          id?: string
          last_seen_at?: string | null
          plan_id?: string | null
          price_ssp?: number | null
          profile?: string | null
          router_id?: string
          site_id?: string
          tenant_id?: string
          used?: boolean
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "router_logins_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "router_logins_router_id_fkey"
            columns: ["router_id"]
            isOneToOne: false
            referencedRelation: "routers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "router_logins_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "router_logins_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      router_profile_ignores: {
        Row: {
          created_at: string
          profile_name: string
          router_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          profile_name: string
          router_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          profile_name?: string
          router_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "router_profile_ignores_router_id_fkey"
            columns: ["router_id"]
            isOneToOne: false
            referencedRelation: "routers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "router_profile_ignores_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      routers: {
        Row: {
          connection: string
          created_at: string
          dns_name: string | null
          host: string | null
          hotspot_info: Json | null
          hotspot_server: string | null
          hotspot_users: Json | null
          id: string
          ip_address: unknown
          last_error: string | null
          last_seen_at: string | null
          last_usage_at: string | null
          model: string | null
          name: string
          password_enc: string | null
          port: number | null
          ros_version: string | null
          site_id: string
          status: string
          tenant_id: string
          token_hash: string | null
          tunnel_ip: string | null
          use_https: boolean | null
          username: string | null
          users_baseline_at: string | null
          wg_private_enc: string | null
          wg_public_key: string | null
          worker_lease_until: string | null
        }
        Insert: {
          connection?: string
          created_at?: string
          dns_name?: string | null
          host?: string | null
          hotspot_info?: Json | null
          hotspot_server?: string | null
          hotspot_users?: Json | null
          id?: string
          ip_address?: unknown
          last_error?: string | null
          last_seen_at?: string | null
          last_usage_at?: string | null
          model?: string | null
          name: string
          password_enc?: string | null
          port?: number | null
          ros_version?: string | null
          site_id: string
          status?: string
          tenant_id: string
          token_hash?: string | null
          tunnel_ip?: string | null
          use_https?: boolean | null
          username?: string | null
          users_baseline_at?: string | null
          wg_private_enc?: string | null
          wg_public_key?: string | null
          worker_lease_until?: string | null
        }
        Update: {
          connection?: string
          created_at?: string
          dns_name?: string | null
          host?: string | null
          hotspot_info?: Json | null
          hotspot_server?: string | null
          hotspot_users?: Json | null
          id?: string
          ip_address?: unknown
          last_error?: string | null
          last_seen_at?: string | null
          last_usage_at?: string | null
          model?: string | null
          name?: string
          password_enc?: string | null
          port?: number | null
          ros_version?: string | null
          site_id?: string
          status?: string
          tenant_id?: string
          token_hash?: string | null
          tunnel_ip?: string | null
          use_https?: boolean | null
          username?: string | null
          users_baseline_at?: string | null
          wg_private_enc?: string | null
          wg_public_key?: string | null
          worker_lease_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "routers_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          amount_ssp: number
          commission_ssp: number
          created_at: string
          id: string
          payment_method: string
          plan_id: string
          request_id: string | null
          router_id: string
          seller_id: string | null
          site_id: string
          sold_at: string
          tenant_id: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          voucher_id: string
        }
        Insert: {
          amount_ssp: number
          commission_ssp?: number
          created_at?: string
          id?: string
          payment_method?: string
          plan_id: string
          request_id?: string | null
          router_id: string
          seller_id?: string | null
          site_id: string
          sold_at?: string
          tenant_id: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          voucher_id: string
        }
        Update: {
          amount_ssp?: number
          commission_ssp?: number
          created_at?: string
          id?: string
          payment_method?: string
          plan_id?: string
          request_id?: string | null
          router_id?: string
          seller_id?: string | null
          site_id?: string
          sold_at?: string
          tenant_id?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_router_id_fkey"
            columns: ["router_id"]
            isOneToOne: false
            referencedRelation: "routers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: true
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          auto_sale_on_login: boolean
          buy_enabled: boolean
          buy_instructions: string | null
          buy_slug: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          tenant_id: string
          timezone: string
        }
        Insert: {
          auto_sale_on_login?: boolean
          buy_enabled?: boolean
          buy_instructions?: string | null
          buy_slug?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          tenant_id: string
          timezone?: string
        }
        Update: {
          auto_sale_on_login?: boolean
          buy_enabled?: boolean
          buy_instructions?: string | null
          buy_slug?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          tenant_id?: string
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "sites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          description: string
          id: string
          is_public: boolean
          max_routers: number | null
          max_sites: number | null
          max_staff: number | null
          max_vouchers_month: number | null
          name: string
          price_per_router_ssp: number | null
          sort: number
          updated_at: string
        }
        Insert: {
          description?: string
          id: string
          is_public?: boolean
          max_routers?: number | null
          max_sites?: number | null
          max_staff?: number | null
          max_vouchers_month?: number | null
          name: string
          price_per_router_ssp?: number | null
          sort?: number
          updated_at?: string
        }
        Update: {
          description?: string
          id?: string
          is_public?: boolean
          max_routers?: number | null
          max_sites?: number | null
          max_staff?: number | null
          max_vouchers_month?: number | null
          name?: string
          price_per_router_ssp?: number | null
          sort?: number
          updated_at?: string
        }
        Relationships: []
      }
      tenant_billing: {
        Row: {
          contact_phone: string | null
          created_via: string
          exempt: boolean
          plan_id: string
          price_per_router_ssp: number | null
          signup_ip: string | null
          status: string
          suspended_at: string | null
          tenant_id: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          contact_phone?: string | null
          created_via?: string
          exempt?: boolean
          plan_id?: string
          price_per_router_ssp?: number | null
          signup_ip?: string | null
          status?: string
          suspended_at?: string | null
          tenant_id: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          contact_phone?: string | null
          created_via?: string
          exempt?: boolean
          plan_id?: string
          price_per_router_ssp?: number | null
          signup_ip?: string | null
          status?: string
          suspended_at?: string | null
          tenant_id?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_billing_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_billing_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          currency: string
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          timezone: string
          usd_rate: number | null
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          timezone?: string
          usd_rate?: number | null
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          timezone?: string
          usd_rate?: number | null
        }
        Relationships: []
      }
      voucher_batches: {
        Row: {
          code_length: number
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          plan_id: string
          quantity: number
          router_id: string
          site_id: string
          tenant_id: string
        }
        Insert: {
          code_length: number
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          plan_id: string
          quantity: number
          router_id: string
          site_id: string
          tenant_id: string
        }
        Update: {
          code_length?: number
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          plan_id?: string
          quantity?: number
          router_id?: string
          site_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voucher_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_batches_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_batches_router_id_fkey"
            columns: ["router_id"]
            isOneToOne: false
            referencedRelation: "routers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_batches_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_batches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vouchers: {
        Row: {
          batch_id: string
          bytes_used: number
          code: string
          created_at: string
          expires_at: string | null
          first_used_at: string | null
          id: string
          on_router: boolean
          plan_id: string
          printed_at: string | null
          router_id: string
          site_id: string
          sold_at: string | null
          status: string
          tenant_id: string
          uptime_used_seconds: number
        }
        Insert: {
          batch_id: string
          bytes_used?: number
          code: string
          created_at?: string
          expires_at?: string | null
          first_used_at?: string | null
          id?: string
          on_router?: boolean
          plan_id: string
          printed_at?: string | null
          router_id: string
          site_id: string
          sold_at?: string | null
          status?: string
          tenant_id: string
          uptime_used_seconds?: number
        }
        Update: {
          batch_id?: string
          bytes_used?: number
          code?: string
          created_at?: string
          expires_at?: string | null
          first_used_at?: string | null
          id?: string
          on_router?: boolean
          plan_id?: string
          printed_at?: string | null
          router_id?: string
          site_id?: string
          sold_at?: string | null
          status?: string
          tenant_id?: string
          uptime_used_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "vouchers_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "voucher_batch_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "voucher_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_router_id_fkey"
            columns: ["router_id"]
            isOneToOne: false
            referencedRelation: "routers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      report_sales: {
        Row: {
          amount_ssp: number | null
          id: string | null
          plan_id: string | null
          seller_id: string | null
          site_id: string | null
          sold_at: string | null
          source: string | null
          tenant_id: string | null
        }
        Relationships: []
      }
      voucher_batch_status: {
        Row: {
          code_length: number | null
          created_at: string | null
          created_by: string | null
          id: string | null
          note: string | null
          plan_color: string | null
          plan_id: string | null
          plan_name: string | null
          price_ssp: number | null
          push_error: string | null
          push_finished_at: string | null
          push_status: string | null
          push_warnings: Json | null
          pushed_count: number | null
          quantity: number | null
          router_id: string | null
          router_name: string | null
          site_id: string | null
          site_name: string | null
          uptime_seconds: number | null
          voucher_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "voucher_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_batches_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_batches_router_id_fkey"
            columns: ["router_id"]
            isOneToOne: false
            referencedRelation: "routers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_batches_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      alerts_scan: { Args: never; Returns: number }
      app_role: { Args: never; Returns: string }
      app_site_id: { Args: never; Returns: string }
      app_tenant_id: { Args: never; Returns: string }
      app_timezone: { Args: never; Returns: string }
      billing_config: {
        Args: { p_default: string; p_key: string }
        Returns: string
      }
      billing_notice: {
        Args: {
          p_body: string
          p_key: string
          p_tenant_id: string
          p_title: string
        }
        Returns: undefined
      }
      billing_overview: { Args: never; Returns: Json }
      billing_run: { Args: never; Returns: Json }
      billing_tenant_of_caller: { Args: never; Returns: string }
      billing_usage: { Args: never; Returns: Json }
      can_access_site: { Args: { target_site: string }; Returns: boolean }
      cash_up: { Args: { p_date: string; p_site_id?: string }; Returns: Json }
      confirm_payment_request: { Args: { p_id: string }; Returns: Json }
      dashboard_summary: { Args: { p_site_id?: string }; Returns: Json }
      expense_site_check: { Args: { p_site_id: string }; Returns: undefined }
      expiring_soon: {
        Args: { p_hours?: number; p_site_id?: string }
        Returns: {
          cards: number
          plan_color: string
          plan_id: string
          plan_name: string
        }[]
      }
      generate_vouchers: {
        Args: {
          p_code_length?: number
          p_plan_id: string
          p_quantity: number
          p_router_id: string
        }
        Returns: string
      }
      get_alert_settings: { Args: never; Returns: Json }
      hzc_cleanup: { Args: never; Returns: undefined }
      hzc_session_rows: {
        Args: { p_sessions: Json }
        Returns: {
          bytes_in: number
          bytes_out: number
          code: string
          ip: string
          mac: string
          uptime: number
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      is_valid_timezone: { Args: { p_tz: string }; Returns: boolean }
      list_sales: {
        Args: {
          p_date_from: string
          p_date_to: string
          p_limit?: number
          p_offset?: number
          p_plan_id?: string
          p_seller_id?: string
          p_site_id?: string
        }
        Returns: {
          amount_ssp: number
          code: string
          plan_color: string
          plan_id: string
          plan_name: string
          router_id: string
          sale_id: string
          seller_id: string
          seller_name: string
          site_id: string
          site_name: string
          sold_at: string
          total_rows: number
          total_sold: number
          total_ssp: number
          void_reason: string
          voided_at: string
          voided_by_name: string
          voucher_id: string
        }[]
      }
      mark_vouchers_printed: {
        Args: { p_voucher_ids: string[] }
        Returns: string[]
      }
      mark_vouchers_sold: {
        Args: { p_seller_id: string; p_voucher_ids: string[] }
        Returns: Json
      }
      mfa_satisfied: { Args: never; Returns: boolean }
      mikroticket_activated_at: {
        Args: { p_comment: string; p_tz: string }
        Returns: string
      }
      mikroticket_activated_at_checked: {
        Args: { p_comment: string; p_tz: string }
        Returns: string
      }
      platform_billing: { Args: never; Returns: Json }
      platform_mark_invoice: {
        Args: { p_invoice_id: string; p_ref?: string; p_status: string }
        Returns: undefined
      }
      platform_plans: { Args: never; Returns: Json }
      platform_save_plan: {
        Args: {
          p_description: string
          p_id: string
          p_is_public: boolean
          p_max_routers: number
          p_max_sites: number
          p_max_staff: number
          p_max_vouchers_month: number
          p_name: string
          p_price_per_router_ssp: number
        }
        Returns: undefined
      }
      platform_set_billing_config: {
        Args: {
          p_grace_days: number
          p_instructions: string
          p_price: number
          p_trial_days: number
        }
        Returns: undefined
      }
      platform_set_business_billing: {
        Args: {
          p_exempt: boolean
          p_price: number
          p_tenant_id: string
          p_trial_ends_at: string
        }
        Returns: undefined
      }
      platform_set_business_plan: {
        Args: { p_plan_id: string; p_tenant_id: string }
        Returns: undefined
      }
      platform_set_tenant_active: {
        Args: { p_active: boolean; p_tenant_id: string }
        Returns: undefined
      }
      platform_support_start: {
        Args: { p_minutes?: number; p_tenant_id: string }
        Returns: Json
      }
      platform_support_stop: { Args: never; Returns: undefined }
      platform_tenant_id: { Args: never; Returns: string }
      platform_tenants: {
        Args: never
        Returns: {
          admin_names: string
          created_at: string
          currency: string
          id: string
          is_active: boolean
          name: string
          routers: number
          sites: number
          staff: number
          timezone: string
        }[]
      }
      profile_key: { Args: { p_name: string }; Returns: string }
      profit_report: {
        Args: { p_date: string; p_period: string; p_site_id?: string }
        Returns: Json
      }
      public_pricing: { Args: never; Returns: Json }
      queue_batch_push: { Args: { p_batch_id: string }; Returns: string }
      raise_alert: {
        Args: {
          p_body?: string
          p_key: string
          p_kind: string
          p_resolved?: boolean
          p_router_id?: string
          p_site_id?: string
          p_tenant_id: string
          p_title: string
        }
        Returns: boolean
      }
      random_numeric_code: { Args: { p_length: number }; Returns: string }
      record_auto_sale: { Args: { p_voucher_id: string }; Returns: boolean }
      record_cash_handover: {
        Args: { p_amount_ssp: number; p_note?: string; p_seller_id: string }
        Returns: Json
      }
      record_router_logins: {
        Args: { p_router_id: string; p_sessions: Json; p_users: Json }
        Returns: Json
      }
      reject_payment_request: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      remove_expense: { Args: { p_id: string }; Returns: undefined }
      report_period: {
        Args: {
          p_date: string
          p_period: string
          p_plan_id?: string
          p_seller_id?: string
          p_site_id?: string
        }
        Returns: Json
      }
      report_sales: {
        Args: {
          p_date_from: string
          p_date_to: string
          p_group_by: string
          p_plan_id?: string
          p_seller_id?: string
          p_site_id: string
        }
        Returns: {
          period_start: string
          revenue_ssp: number
          vouchers_sold: number
        }[]
      }
      report_site_scope: { Args: { p_site_id: string }; Returns: string }
      router_code_length: { Args: { p_router_id: string }; Returns: number }
      router_own_profiles: { Args: { p_info: Json }; Returns: string[] }
      router_secret_key: { Args: never; Returns: string }
      save_alert_settings: {
        Args: {
          p_low_stock_threshold: number
          p_notify_low_stock: boolean
          p_notify_offline: boolean
          p_notify_payments: boolean
          p_notify_push: boolean
        }
        Returns: Json
      }
      save_business_settings: {
        Args: { p_logo_url: string; p_name: string; p_usd_rate: number }
        Returns: undefined
      }
      save_buy_settings: {
        Args: {
          p_enabled: boolean
          p_hosts: string[]
          p_instructions: string
          p_site_id: string
          p_slug: string
        }
        Returns: undefined
      }
      save_expense: {
        Args: {
          p_amount_ssp: number
          p_category: string
          p_id: string
          p_note: string
          p_site_id: string
          p_spent_on: string
        }
        Returns: string
      }
      sell_voucher: {
        Args: { p_plan_id: string; p_request_id?: string; p_router_id: string }
        Returns: {
          amount_ssp: number
          code: string
          sale_id: string
          sold_at: string
          voucher_id: string
        }[]
      }
      seller_cash_held: { Args: { p_seller_id: string }; Returns: number }
      set_seller_terms: {
        Args: {
          p_commission_pct: number
          p_credit_limit_ssp: number
          p_profile_id: string
        }
        Returns: undefined
      }
      submit_invoice_payment: {
        Args: { p_invoice_id: string; p_ref: string }
        Returns: undefined
      }
      support_session: { Args: never; Returns: Json }
      sync_router_usage: {
        Args: { p_router_id: string; p_sessions: Json; p_users: Json }
        Returns: Json
      }
      unmark_vouchers_printed: {
        Args: { p_voucher_ids: string[] }
        Returns: number
      }
      void_sale: {
        Args: { p_reason: string; p_sale_id: string }
        Returns: undefined
      }
      voucher_stock: {
        Args: { p_router_id: string }
        Returns: {
          available: number
          plan_id: string
        }[]
      }
      wake_alerts_sender: { Args: never; Returns: undefined }
      wake_direct_worker: { Args: { p_router_id: string }; Returns: undefined }
      write_audit: {
        Args: { p_action: string; p_details: Json }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

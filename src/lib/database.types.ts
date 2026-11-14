export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          operationName?: string;
          query?: string;
          variables?: Json;
          extensions?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      availabilities: {
        Row: {
          availability: boolean;
          created_at: string;
          event_date_id: string;
          event_id: string;
          id: string;
          participant_id: string;
        };
        ComputedFields: never;
        Insert: {
          availability: boolean;
          created_at?: string;
          event_date_id: string;
          event_id: string;
          id?: string;
          participant_id: string;
        };
        Update: {
          availability?: boolean;
          created_at?: string;
          event_date_id?: string;
          event_id?: string;
          id?: string;
          participant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'availabilities_event_date_id_fkey';
            columns: ['event_date_id'];
            isOneToOne: false;
            referencedRelation: 'event_dates';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'availabilities_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'availabilities_participant_id_fkey';
            columns: ['participant_id'];
            isOneToOne: false;
            referencedRelation: 'participants';
            referencedColumns: ['id'];
          },
        ];
      };
      date_first_time_responses: {
        Row: {
          availability: boolean | null;
          event_date_id: string;
          event_id: string;
          participant_id: string;
          source: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          availability?: boolean | null;
          event_date_id: string;
          event_id: string;
          participant_id: string;
          source: string;
          updated_at?: string;
        };
        Update: {
          availability?: boolean | null;
          event_date_id?: string;
          event_id?: string;
          participant_id?: string;
          source?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'date_first_time_responses_event_date_id_event_id_fkey';
            columns: ['event_date_id', 'event_id'];
            isOneToOne: false;
            referencedRelation: 'event_dates';
            referencedColumns: ['id', 'event_id'];
          },
          {
            foreignKeyName: 'date_first_time_responses_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'date_first_time_responses_participant_id_event_id_fkey';
            columns: ['participant_id', 'event_id'];
            isOneToOne: false;
            referencedRelation: 'participants';
            referencedColumns: ['id', 'event_id'];
          },
        ];
      };
      day_response_intervals: {
        Row: {
          day_response_id: string;
          end_offset_minutes: number;
          id: string;
          start_offset_minutes: number;
        };
        ComputedFields: never;
        Insert: {
          day_response_id: string;
          end_offset_minutes: number;
          id?: string;
          start_offset_minutes: number;
        };
        Update: {
          day_response_id?: string;
          end_offset_minutes?: number;
          id?: string;
          start_offset_minutes?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'day_response_intervals_day_response_id_fkey';
            columns: ['day_response_id'];
            isOneToOne: false;
            referencedRelation: 'event_day_responses';
            referencedColumns: ['id'];
          },
        ];
      };
      event_access_histories: {
        Row: {
          access_count: number;
          event_public_token: string;
          event_title: string;
          first_accessed_at: string;
          id: string;
          is_created_by_me: boolean;
          last_accessed_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          access_count?: number;
          event_public_token: string;
          event_title: string;
          first_accessed_at?: string;
          id?: string;
          is_created_by_me?: boolean;
          last_accessed_at?: string;
          user_id: string;
        };
        Update: {
          access_count?: number;
          event_public_token?: string;
          event_title?: string;
          first_accessed_at?: string;
          id?: string;
          is_created_by_me?: boolean;
          last_accessed_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'event_access_histories_event_public_token_fkey';
            columns: ['event_public_token'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['public_token'];
          },
        ];
      };
      event_candidate_days: {
        Row: {
          confirmed_at: string | null;
          event_id: string;
          id: string;
          local_date: string;
          prefinal_time_target: boolean;
        };
        ComputedFields: never;
        Insert: {
          confirmed_at?: string | null;
          event_id: string;
          id?: string;
          local_date: string;
          prefinal_time_target?: boolean;
        };
        Update: {
          confirmed_at?: string | null;
          event_id?: string;
          id?: string;
          local_date?: string;
          prefinal_time_target?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'event_candidate_days_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
        ];
      };
      event_dates: {
        Row: {
          candidate_day_id: string | null;
          created_at: string;
          end_time: string;
          event_id: string;
          id: string;
          label: string | null;
          retired_at: string | null;
          start_time: string;
        };
        ComputedFields: never;
        Insert: {
          candidate_day_id?: string | null;
          created_at?: string;
          end_time: string;
          event_id: string;
          id?: string;
          label?: string | null;
          retired_at?: string | null;
          start_time: string;
        };
        Update: {
          candidate_day_id?: string | null;
          created_at?: string;
          end_time?: string;
          event_id?: string;
          id?: string;
          label?: string | null;
          retired_at?: string | null;
          start_time?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'event_dates_candidate_day_id_event_id_fkey';
            columns: ['candidate_day_id', 'event_id'];
            isOneToOne: false;
            referencedRelation: 'event_candidate_days';
            referencedColumns: ['id', 'event_id'];
          },
          {
            foreignKeyName: 'event_dates_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
        ];
      };
      event_day_responses: {
        Row: {
          candidate_day_id: string;
          comment: string | null;
          event_id: string;
          id: string;
          participant_id: string;
          source: string;
          status: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          candidate_day_id: string;
          comment?: string | null;
          event_id: string;
          id?: string;
          participant_id: string;
          source: string;
          status?: string | null;
          updated_at?: string;
        };
        Update: {
          candidate_day_id?: string;
          comment?: string | null;
          event_id?: string;
          id?: string;
          participant_id?: string;
          source?: string;
          status?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'event_day_responses_candidate_day_id_event_id_fkey';
            columns: ['candidate_day_id', 'event_id'];
            isOneToOne: false;
            referencedRelation: 'event_candidate_days';
            referencedColumns: ['id', 'event_id'];
          },
          {
            foreignKeyName: 'event_day_responses_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'event_day_responses_participant_id_event_id_fkey';
            columns: ['participant_id', 'event_id'];
            isOneToOne: false;
            referencedRelation: 'participants';
            referencedColumns: ['id', 'event_id'];
          },
        ];
      };
      events: {
        Row: {
          adjustment_stage: string | null;
          admin_password_hash: string | null;
          admin_token: string;
          base_time_ranges: Json | null;
          created_at: string;
          created_by: string | null;
          creation_payload_hash: string | null;
          creation_request_id: string | null;
          description: string | null;
          final_date_id: string | null;
          id: string;
          is_finalized: boolean;
          last_accessed_at: string | null;
          public_token: string;
          revision: number;
          scheduling_mode: string;
          title: string;
        };
        ComputedFields: never;
        Insert: {
          adjustment_stage?: string | null;
          admin_password_hash?: string | null;
          admin_token?: string;
          base_time_ranges?: Json | null;
          created_at?: string;
          created_by?: string | null;
          creation_payload_hash?: string | null;
          creation_request_id?: string | null;
          description?: string | null;
          final_date_id?: string | null;
          id?: string;
          is_finalized?: boolean;
          last_accessed_at?: string | null;
          public_token: string;
          revision?: number;
          scheduling_mode?: string;
          title: string;
        };
        Update: {
          adjustment_stage?: string | null;
          admin_password_hash?: string | null;
          admin_token?: string;
          base_time_ranges?: Json | null;
          created_at?: string;
          created_by?: string | null;
          creation_payload_hash?: string | null;
          creation_request_id?: string | null;
          description?: string | null;
          final_date_id?: string | null;
          id?: string;
          is_finalized?: boolean;
          last_accessed_at?: string | null;
          public_token?: string;
          revision?: number;
          scheduling_mode?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'fk_events_final_date';
            columns: ['final_date_id'];
            isOneToOne: false;
            referencedRelation: 'event_dates';
            referencedColumns: ['id'];
          },
        ];
      };
      finalized_dates: {
        Row: {
          created_at: string;
          event_date_id: string;
          event_id: string;
          id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          event_date_id: string;
          event_id: string;
          id?: string;
        };
        Update: {
          created_at?: string;
          event_date_id?: string;
          event_id?: string;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'finalized_dates_event_date_id_fkey';
            columns: ['event_date_id', 'event_id'];
            isOneToOne: false;
            referencedRelation: 'event_dates';
            referencedColumns: ['id', 'event_id'];
          },
          {
            foreignKeyName: 'finalized_dates_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
        ];
      };
      participants: {
        Row: {
          comment: string | null;
          created_at: string;
          creation_payload_hash: string | null;
          creation_request_id: string | null;
          day_answers_revision: number;
          detail_answers_revision: number;
          event_id: string;
          id: string;
          name: string;
          response_token: string | null;
        };
        ComputedFields: never;
        Insert: {
          comment?: string | null;
          created_at?: string;
          creation_payload_hash?: string | null;
          creation_request_id?: string | null;
          day_answers_revision?: number;
          detail_answers_revision?: number;
          event_id: string;
          id?: string;
          name: string;
          response_token?: string | null;
        };
        Update: {
          comment?: string | null;
          created_at?: string;
          creation_payload_hash?: string | null;
          creation_request_id?: string | null;
          day_answers_revision?: number;
          detail_answers_revision?: number;
          event_id?: string;
          id?: string;
          name?: string;
          response_token?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'participants_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
        ];
      };
      user_event_availability_overrides: {
        Row: {
          availability: boolean;
          event_date_id: string;
          event_id: string;
          id: string;
          reason: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          availability: boolean;
          event_date_id: string;
          event_id: string;
          id?: string;
          reason: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          availability?: boolean;
          event_date_id?: string;
          event_id?: string;
          id?: string;
          reason?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_event_availability_overrides_event_date_id_fkey';
            columns: ['event_date_id'];
            isOneToOne: false;
            referencedRelation: 'event_dates';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_event_availability_overrides_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
        ];
      };
      user_event_links: {
        Row: {
          auto_sync: boolean;
          created_at: string;
          event_id: string;
          id: string;
          participant_id: string | null;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          auto_sync?: boolean;
          created_at?: string;
          event_id: string;
          id?: string;
          participant_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          auto_sync?: boolean;
          created_at?: string;
          event_id?: string;
          id?: string;
          participant_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_event_links_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_event_links_participant_id_fkey';
            columns: ['participant_id'];
            isOneToOne: false;
            referencedRelation: 'participants';
            referencedColumns: ['id'];
          },
        ];
      };
      user_schedule_blocks: {
        Row: {
          availability: boolean;
          end_time: string;
          event_id: string | null;
          id: string;
          source: string;
          start_time: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          availability: boolean;
          end_time: string;
          event_id?: string | null;
          id?: string;
          source: string;
          start_time: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          availability?: boolean;
          end_time?: string;
          event_id?: string | null;
          id?: string;
          source?: string;
          start_time?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_schedule_blocks_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      add_event_dates_safe: { Args: { p_event_dates: Json; p_event_id: string }; Returns: boolean };
      create_event_with_dates: {
        Args: {
          p_admin_token: string;
          p_description: string;
          p_event_dates: Json;
          p_public_token: string;
          p_title: string;
        };
        Returns: {
          admin_token: string;
          event_id: string;
          public_token: string;
        }[];
      };
      finalize_event_safe: { Args: { p_date_ids: Json; p_event_id: string }; Returns: boolean };
      find_old_events: {
        Args: { threshold: string };
        Returns: {
          id: string;
        }[];
      };
      submit_availability_bundle: {
        Args: {
          p_availabilities: Json;
          // SQLで明示的に許可するNULLは、CLI生成型で失われるため補完する。
          p_comment: string | null;
          p_event_id: string;
          p_override_date_ids?: Json;
          p_participant_id: string | null;
          p_participant_name: string;
          p_public_token: string;
          p_user_id: string | null;
        };
        Returns: {
          event_title: string;
          message: string;
          participant_id: string;
          success: boolean;
        }[];
      };
      touch_event_last_accessed_if_stale: {
        Args: { p_accessed_at?: string; p_min_interval_minutes?: number; p_public_token: string };
        Returns: boolean;
      };
      update_participant_availability: {
        Args: { p_availabilities: Json; p_event_id: string; p_participant_id: string };
        Returns: boolean;
      };
      upsert_event_access_histories_bulk: {
        Args: { p_items: Json; p_user_id: string };
        Returns: {
          processed_count: number;
          skipped_count: number;
        }[];
      };
      upsert_event_access_history: {
        Args: {
          p_accessed_at: string;
          p_event_public_token: string;
          p_event_title: string;
          p_is_created_by_me: boolean;
          p_user_id: string;
        };
        Returns: {
          access_count: number;
          event_public_token: string;
          event_title: string;
          first_accessed_at: string;
          id: string;
          is_created_by_me: boolean;
          last_accessed_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'event_access_histories';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      uuid_generate_v1: { Args: Record<PropertyKey, never>; Returns: string };
      uuid_generate_v1mc: { Args: Record<PropertyKey, never>; Returns: string };
      uuid_generate_v3: { Args: { name: string; namespace: string }; Returns: string };
      uuid_generate_v4: { Args: Record<PropertyKey, never>; Returns: string };
      uuid_generate_v5: { Args: { name: string; namespace: string }; Returns: string };
      uuid_nil: { Args: Record<PropertyKey, never>; Returns: string };
      uuid_ns_dns: { Args: Record<PropertyKey, never>; Returns: string };
      uuid_ns_oid: { Args: Record<PropertyKey, never>; Returns: string };
      uuid_ns_url: { Args: Record<PropertyKey, never>; Returns: string };
      uuid_ns_x500: { Args: Record<PropertyKey, never>; Returns: string };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DefaultSchema = Database[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema['Tables'] & DefaultSchema['Views']) | { schema: keyof Database },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database;
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        Database[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      Database[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof Database },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database;
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof Database },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database;
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums'] | { schema: keyof Database },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database;
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof Database },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database;
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;

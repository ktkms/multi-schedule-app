-- 日付先行型を追加する。旧日時先行型の保存意味は維持する。
BEGIN;
CREATE SCHEMA date_first;
ALTER TABLE public.events
  ADD scheduling_mode text NOT NULL DEFAULT 'time_first'
    CHECK (scheduling_mode IN ('time_first','date_first')),
  ADD adjustment_stage text,
  ADD revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  ADD base_time_ranges jsonb,
  ADD creation_request_id uuid UNIQUE,
  ADD creation_payload_hash text,
  ADD CHECK ((scheduling_mode='time_first' AND adjustment_stage IS NULL)
    OR (scheduling_mode='date_first' AND adjustment_stage IS NOT NULL AND adjustment_stage IN ('days','times')));
ALTER TABLE public.participants
  ADD day_answers_revision bigint NOT NULL DEFAULT 0,
  ADD detail_answers_revision bigint NOT NULL DEFAULT 0,
  ADD creation_request_id uuid,
  ADD creation_payload_hash text,
  ADD UNIQUE (event_id,creation_request_id),
  ADD UNIQUE (id,event_id);
CREATE TABLE public.event_candidate_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  local_date date NOT NULL CHECK (local_date>='0001-01-01' AND local_date<'9999-12-31'),
  confirmed_at timestamptz,
  prefinal_time_target boolean NOT NULL DEFAULT false,
  UNIQUE (event_id,local_date), UNIQUE (id,event_id)
);
ALTER TABLE public.event_dates
  ADD candidate_day_id uuid,
  ADD retired_at timestamptz,
  ADD UNIQUE (id,event_id),
  ADD FOREIGN KEY (candidate_day_id,event_id)
    REFERENCES public.event_candidate_days(id,event_id);
CREATE UNIQUE INDEX date_first_old_time_unique
  ON public.event_dates(event_id,start_time,end_time) WHERE candidate_day_id IS NULL;
CREATE UNIQUE INDEX date_first_day_time_unique
  ON public.event_dates(event_id,candidate_day_id,start_time,end_time)
  WHERE candidate_day_id IS NOT NULL;
ALTER TABLE public.event_dates DROP CONSTRAINT uniq_timerange_per_event;
-- PostgRESTの既存埋め込みが曖昧にならないよう、元の参照名を維持して置き換える。
ALTER TABLE public.finalized_dates DROP CONSTRAINT finalized_dates_event_date_id_fkey;
ALTER TABLE public.finalized_dates ADD CONSTRAINT finalized_dates_event_date_id_fkey
  FOREIGN KEY (event_date_id,event_id) REFERENCES public.event_dates(id,event_id) ON DELETE CASCADE;
CREATE TABLE public.event_day_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL,
  candidate_day_id uuid NOT NULL,
  status text CHECK (status IN ('yes','maybe','no')),
  source text NOT NULL CHECK (source IN ('manual','account')),
  comment text CHECK (char_length(comment)<=2000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IS NOT NULL OR (source='manual' AND comment IS NULL)),
  UNIQUE (participant_id,candidate_day_id),
  FOREIGN KEY (participant_id,event_id) REFERENCES public.participants(id,event_id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_day_id,event_id) REFERENCES public.event_candidate_days(id,event_id)
);
CREATE TABLE public.day_response_intervals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_response_id uuid NOT NULL REFERENCES public.event_day_responses(id) ON DELETE CASCADE,
  start_offset_minutes integer NOT NULL,
  end_offset_minutes integer NOT NULL,
  CHECK (0<=start_offset_minutes AND start_offset_minutes<end_offset_minutes
    AND end_offset_minutes<=1800)
);
CREATE INDEX ON public.day_response_intervals(day_response_id);
CREATE TABLE public.date_first_time_responses (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL,
  event_date_id uuid NOT NULL,
  availability boolean,
  source text NOT NULL CHECK (source IN ('manual','account')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (availability IS NOT NULL OR source='manual'),
  PRIMARY KEY (participant_id,event_date_id),
  FOREIGN KEY (participant_id,event_id) REFERENCES public.participants(id,event_id) ON DELETE CASCADE,
  FOREIGN KEY (event_date_id,event_id) REFERENCES public.event_dates(id,event_id)
);

-- 親日付と時刻を後から変えず、新方式の日時境界を検証する。
CREATE FUNCTION date_first.guard_slot() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,pg_temp AS $$
DECLARE m text; day_date date;
BEGIN
  SELECT scheduling_mode INTO m FROM public.events WHERE id=NEW.event_id;
  IF TG_OP='UPDATE' AND (m='date_first' OR OLD.candidate_day_id IS NOT NULL) AND
    ROW(OLD.event_id,OLD.candidate_day_id,OLD.start_time,OLD.end_time)
    IS DISTINCT FROM ROW(NEW.event_id,NEW.candidate_day_id,NEW.start_time,NEW.end_time)
  THEN RAISE EXCEPTION 'immutable_slot'; END IF;
  IF m='time_first' THEN
    IF NEW.candidate_day_id IS NOT NULL THEN RAISE EXCEPTION 'invalid_mode'; END IF;
  ELSE
    SELECT local_date INTO day_date FROM public.event_candidate_days
      WHERE id=NEW.candidate_day_id AND event_id=NEW.event_id;
    IF day_date IS NULL OR NEW.start_time<day_date::timestamp
      OR NEW.end_time>day_date::timestamp+interval '30 hours'
      OR NEW.start_time>=NEW.end_time
      OR date_trunc('minute',NEW.start_time)<>NEW.start_time
      OR date_trunc('minute',NEW.end_time)<>NEW.end_time
    THEN RAISE EXCEPTION 'invalid_slot_range'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER date_first_guard_slot BEFORE INSERT OR UPDATE ON public.event_dates
FOR EACH ROW EXECUTE FUNCTION date_first.guard_slot();

-- 最終状態を検査し、正当な更新途中の状態を許す。
CREATE FUNCTION date_first.check_state() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,pg_temp AS $$
DECLARE e uuid; response_id uuid;
BEGIN
  IF TG_TABLE_NAME='day_response_intervals' THEN
    response_id:=CASE WHEN TG_OP='DELETE' THEN OLD.day_response_id ELSE NEW.day_response_id END;
    SELECT event_id INTO e FROM public.event_day_responses WHERE id=response_id;
  ELSE e:=CASE WHEN TG_OP='DELETE' THEN OLD.event_id ELSE NEW.event_id END;
  END IF;
  IF e IS NULL OR NOT EXISTS (SELECT 1 FROM public.events
    WHERE id=e AND scheduling_mode='date_first') THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME IN ('event_day_responses','day_response_intervals') THEN
    IF TG_TABLE_NAME='event_day_responses' THEN
      response_id:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
    END IF;
    IF EXISTS (SELECT 1 FROM public.event_day_responses r
      JOIN public.day_response_intervals i ON i.day_response_id=r.id
      WHERE r.id=response_id AND r.status IS DISTINCT FROM 'maybe')
    THEN RAISE EXCEPTION 'interval_requires_maybe'; END IF;
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.finalized_dates WHERE event_id=e)
    THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.finalized_dates f
    JOIN public.event_dates d ON d.id=f.event_date_id
    LEFT JOIN public.event_candidate_days c ON c.id=d.candidate_day_id
    WHERE f.event_id=e AND (d.event_id<>e OR c.confirmed_at IS NULL OR d.retired_at IS NOT NULL))
  THEN RAISE EXCEPTION 'invalid_finalization'; END IF;
  IF EXISTS (SELECT 1 FROM public.finalized_dates f1
    JOIN public.event_dates d1 ON d1.id=f1.event_date_id
    JOIN public.finalized_dates f2 ON f2.event_id=f1.event_id AND f2.id>f1.id
    JOIN public.event_dates d2 ON d2.id=f2.event_date_id
    WHERE f1.event_id=e AND d1.start_time<d2.end_time AND d1.end_time>d2.start_time)
  THEN RAISE EXCEPTION 'overlapping_finalization'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER date_first_day_check
AFTER INSERT OR UPDATE OR DELETE ON public.event_day_responses
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION date_first.check_state();
CREATE CONSTRAINT TRIGGER date_first_interval_check
AFTER INSERT OR UPDATE OR DELETE ON public.day_response_intervals
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION date_first.check_state();
CREATE CONSTRAINT TRIGGER date_first_final_check
AFTER INSERT OR UPDATE OR DELETE ON public.finalized_dates
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION date_first.check_state();
CREATE CONSTRAINT TRIGGER date_first_candidate_check
AFTER INSERT OR UPDATE OR DELETE ON public.event_candidate_days
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION date_first.check_state();
CREATE CONSTRAINT TRIGGER date_first_slot_check
AFTER INSERT OR UPDATE OR DELETE ON public.event_dates
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION date_first.check_state();

-- JSONの型・区間・件数を内部DB境界でも検証する。
CREATE FUNCTION date_first.validate_ranges(p_ranges jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r jsonb; lo integer; hi integer;
BEGIN
  IF jsonb_typeof(p_ranges) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF jsonb_array_length(p_ranges)>900 THEN RAISE EXCEPTION 'limit_exceeded'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_ranges) LOOP
    IF jsonb_typeof(r)<>'array' OR jsonb_array_length(r)<>2
      OR jsonb_typeof(r->0)<>'number' OR jsonb_typeof(r->1)<>'number'
      OR r->>0 !~ '^[0-9]+$' OR r->>1 !~ '^[0-9]+$'
      THEN RAISE EXCEPTION 'invalid_input'; END IF;
    lo:=(r->>0)::integer; hi:=(r->>1)::integer;
    IF lo>=hi OR hi>1800 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  END LOOP;
END $$;
CREATE FUNCTION date_first.validate_changes(p_kind text,p_changes jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE x jsonb;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('days','times')
    OR jsonb_typeof(p_changes) IS DISTINCT FROM 'array'
    OR octet_length(p_changes::text)>1048576 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF jsonb_array_length(p_changes)>(CASE WHEN p_kind='days' THEN 90 ELSE 3000 END)
    THEN RAISE EXCEPTION 'limit_exceeded'; END IF;
  FOR x IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
    IF jsonb_typeof(x)<>'object' OR jsonb_typeof(x->'id') IS DISTINCT FROM 'string'
      OR (x->>'id')::uuid IS NULL THEN RAISE EXCEPTION 'invalid_input'; END IF;
    IF p_kind='days' THEN
      IF EXISTS(SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN ('id','status','comment','intervals'))
        OR NOT(x?'status' OR x?'comment' OR x?'intervals')
        OR (x?'status' AND jsonb_typeof(x->'status')<>'null'
          AND (jsonb_typeof(x->'status')<>'string' OR x->>'status' NOT IN ('yes','maybe','no')))
        OR (x?'comment' AND jsonb_typeof(x->'comment') NOT IN ('string','null'))
        OR char_length(coalesce(x->>'comment',''))>2000 THEN RAISE EXCEPTION 'invalid_input'; END IF;
      IF x?'intervals' THEN PERFORM date_first.validate_ranges(x->'intervals'); END IF;
    ELSE
      IF EXISTS(SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN ('id','availability'))
        OR NOT(x?'availability') OR jsonb_typeof(x->'availability') NOT IN ('boolean','null')
        THEN RAISE EXCEPTION 'invalid_input'; END IF;
    END IF;
  END LOOP;
END $$;

-- 作成要求は初回入力で照合し、再送時には初回データを再適用しない。
CREATE FUNCTION date_first.create_event(p_request uuid,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE e public.events; h text; d jsonb;
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_body) IS DISTINCT FROM 'object'
    OR octet_length(p_body::text)>1048576
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_body) k
      WHERE k NOT IN ('title','description','days','base_ranges'))
    OR jsonb_typeof(p_body->'title') IS DISTINCT FROM 'string'
    OR (p_body?'description' AND jsonb_typeof(p_body->'description') NOT IN ('string','null'))
    OR char_length(coalesce(p_body->>'description',''))>5000
    OR jsonb_typeof(p_body->'days') IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_body?'base_ranges' THEN PERFORM date_first.validate_ranges(p_body->'base_ranges'); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_body->'days') candidate(value)
    WHERE jsonb_typeof(candidate.value)<>'string' OR (candidate.value#>>'{}')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR (candidate.value#>>'{}')::date<'0001-01-01'::date OR (candidate.value#>>'{}')::date>='9999-12-31'::date)
    THEN RAISE EXCEPTION 'invalid_input'; END IF;
  h:=encode(sha256(convert_to(p_body::text,'UTF8')),'hex');
  IF char_length(btrim(p_body->>'title')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF jsonb_array_length(p_body->'days') NOT BETWEEN 1 AND 90
    OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(p_body->'days'))<>
      jsonb_array_length(p_body->'days') THEN RAISE EXCEPTION 'invalid_input'; END IF;
  INSERT INTO public.events(title,public_token,scheduling_mode,adjustment_stage,
    creation_request_id,creation_payload_hash,description,base_time_ranges)
  VALUES (btrim(p_body->>'title'),replace(gen_random_uuid()::text,'-',''),'date_first','days',p_request,h,nullif(p_body->>'description',''),coalesce(p_body->'base_ranges','[[600,1320]]'::jsonb))
  ON CONFLICT (creation_request_id) DO NOTHING RETURNING * INTO e;
  IF e.id IS NULL THEN
    SELECT * INTO e FROM public.events WHERE creation_request_id=p_request;
    IF e.creation_payload_hash<>h THEN RAISE EXCEPTION 'request_conflict'; END IF;
    RETURN jsonb_build_object('id',e.id,'token',e.public_token,'replayed',true);
  END IF;
  FOR d IN SELECT value FROM jsonb_array_elements(p_body->'days') LOOP
    INSERT INTO public.event_candidate_days(event_id,local_date) VALUES(e.id,(d#>>'{}')::date);
  END LOOP;
  RETURN jsonb_build_object('id',e.id,'token',e.public_token,'replayed',false);
END $$;

CREATE FUNCTION date_first.create_participant(p_token text,p_request uuid,p_body jsonb)
RETURNS uuid LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE e uuid; p public.participants; h text;
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_body) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_body->'name') IS DISTINCT FROM 'string'
    OR char_length(btrim(p_body->>'name')) NOT BETWEEN 1 AND 100
    THEN RAISE EXCEPTION 'invalid_input'; END IF;
  SELECT id INTO STRICT e FROM public.events
    WHERE public_token=p_token AND scheduling_mode='date_first' FOR SHARE;
  h:=encode(sha256(convert_to(p_body::text,'UTF8')),'hex');
  INSERT INTO public.participants(event_id,name,creation_request_id,creation_payload_hash)
  VALUES(e,btrim(p_body->>'name'),p_request,h)
  ON CONFLICT (event_id,creation_request_id) DO NOTHING RETURNING * INTO p;
  IF p.id IS NULL THEN
    SELECT * INTO p FROM public.participants WHERE event_id=e AND creation_request_id=p_request;
    IF p.creation_payload_hash<>h THEN RAISE EXCEPTION 'request_conflict'; END IF;
  END IF;
  RETURN p.id;
END $$;

CREATE FUNCTION date_first.add_days(p_token text,p_revision bigint,p_days date[])
RETURNS bigint LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE e public.events; n integer;
BEGIN
  IF p_revision IS NULL OR p_revision<0 OR p_days IS NULL OR cardinality(p_days) NOT BETWEEN 1 AND 90
    THEN RAISE EXCEPTION 'invalid_input'; END IF;
  SELECT * INTO STRICT e FROM public.events
    WHERE public_token=p_token AND scheduling_mode='date_first' FOR UPDATE;
  IF e.revision<>p_revision THEN RAISE EXCEPTION 'stale_revision'; END IF;
  IF cardinality(p_days)<> (SELECT count(DISTINCT x) FROM unnest(p_days) x)
    THEN RAISE EXCEPTION 'invalid_input'; END IF;
  SELECT count(*) INTO n FROM (
    SELECT local_date FROM public.event_candidate_days WHERE event_id=e.id
    UNION SELECT unnest(p_days)
  ) s;
  IF n>90 THEN RAISE EXCEPTION 'limit_exceeded'; END IF;
  INSERT INTO public.event_candidate_days(event_id,local_date)
    SELECT e.id,x FROM unnest(p_days) x ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT;
  UPDATE public.events SET revision=revision+CASE WHEN n>0 THEN 1 ELSE 0 END
    WHERE id=e.id RETURNING revision INTO e.revision;
  RETURN e.revision;
END $$;

-- 候補設定の件数・復活を検査する処理。確定枠の引退は明示確認後に実行する。
CREATE FUNCTION date_first.set_targets(p_token text,p_revision bigint,p_days uuid[]) RETURNS bigint
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE e public.events; old_targets uuid[]; new_targets uuid[];
BEGIN
  IF p_revision IS NULL OR p_revision<0 OR p_days IS NULL OR cardinality(p_days)>90
    OR cardinality(p_days)<>(SELECT count(DISTINCT x) FROM unnest(p_days) x)
    THEN RAISE EXCEPTION 'invalid_input'; END IF;
  SELECT * INTO STRICT e FROM public.events WHERE public_token=p_token AND scheduling_mode='date_first' FOR UPDATE;
  IF e.revision<>p_revision THEN RAISE EXCEPTION 'stale_revision'; END IF;
  IF EXISTS(SELECT 1 FROM public.event_candidate_days WHERE event_id=e.id AND confirmed_at IS NOT NULL)
    THEN RAISE EXCEPTION 'invalid_event_scope'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_days) x WHERE NOT EXISTS(
    SELECT 1 FROM public.event_candidate_days WHERE id=x AND event_id=e.id))
    THEN RAISE EXCEPTION 'invalid_event_scope'; END IF;
  SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO old_targets FROM public.event_candidate_days
    WHERE event_id=e.id AND prefinal_time_target;
  SELECT coalesce(array_agg(x ORDER BY x),'{}') INTO new_targets FROM unnest(p_days) x;
  UPDATE public.event_candidate_days SET prefinal_time_target=id=ANY(p_days) WHERE event_id=e.id;
  UPDATE public.events SET adjustment_stage='times',revision=revision+
    CASE WHEN old_targets IS DISTINCT FROM new_targets OR adjustment_stage<>'times' THEN 1 ELSE 0 END
    WHERE id=e.id RETURNING revision INTO e.revision;
  RETURN e.revision;
END $$;

CREATE FUNCTION date_first.add_slots(p_token text,p_revision bigint,p_day uuid,
  p_ranges jsonb,p_retire uuid[] DEFAULT '{}',p_ack uuid[] DEFAULT '{}') RETURNS bigint
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE e public.events; r jsonb; c public.event_candidate_days; total_count integer; removed uuid[]; before_state jsonb; after_state jsonb;
BEGIN
  IF p_revision IS NULL OR p_revision<0 OR jsonb_typeof(p_ranges) IS DISTINCT FROM 'array'
    OR p_retire IS NULL OR p_ack IS NULL
    OR cardinality(p_retire)<>(SELECT count(DISTINCT x) FROM unnest(p_retire) x)
    OR cardinality(p_ack)<>(SELECT count(DISTINCT x) FROM unnest(p_ack) x)
    THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF jsonb_array_length(p_ranges)>3000 OR cardinality(p_retire)>3000
    OR cardinality(p_ack)>3000 THEN RAISE EXCEPTION 'limit_exceeded'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_ranges) LOOP
    PERFORM date_first.validate_ranges(jsonb_build_array(r));
  END LOOP;
  SELECT * INTO STRICT e FROM public.events
    WHERE public_token=p_token AND scheduling_mode='date_first' FOR UPDATE;
  IF e.revision<>p_revision THEN RAISE EXCEPTION 'stale_revision'; END IF;
  SELECT * INTO STRICT c FROM public.event_candidate_days WHERE id=p_day AND event_id=e.id;
  IF EXISTS(SELECT 1 FROM public.event_candidate_days WHERE event_id=e.id AND confirmed_at IS NOT NULL)
    AND c.confirmed_at IS NULL AND jsonb_array_length(p_ranges)>0 THEN RAISE EXCEPTION 'invalid_event_scope'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_retire) x WHERE NOT EXISTS(
    SELECT 1 FROM public.event_dates WHERE id=x AND event_id=e.id))
    THEN RAISE EXCEPTION 'invalid_event_scope'; END IF;
  SELECT coalesce(array_agg(event_date_id ORDER BY event_date_id),'{}') INTO removed
    FROM public.finalized_dates WHERE event_id=e.id AND event_date_id=ANY(p_retire);
  IF removed<>(SELECT coalesce(array_agg(x ORDER BY x),'{}') FROM unnest(p_ack) x)
    THEN RAISE EXCEPTION 'requires_confirmation'; END IF;
  before_state:=jsonb_build_object('stage',e.adjustment_stage,'target',c.prefinal_time_target,
    'slots',(SELECT jsonb_agg(jsonb_build_array(id,retired_at IS NOT NULL) ORDER BY id)
      FROM public.event_dates WHERE event_id=e.id));
  DELETE FROM public.finalized_dates WHERE event_id=e.id AND event_date_id=ANY(p_retire);
  UPDATE public.event_dates SET retired_at=now() WHERE event_id=e.id AND id=ANY(p_retire) AND retired_at IS NULL;
  FOR r IN SELECT value FROM jsonb_array_elements(p_ranges) LOOP
    INSERT INTO public.event_dates(event_id,candidate_day_id,start_time,end_time)
      VALUES(e.id,c.id,c.local_date::timestamp+make_interval(mins=>(r->>0)::integer),
        c.local_date::timestamp+make_interval(mins=>(r->>1)::integer))
      ON CONFLICT (event_id,candidate_day_id,start_time,end_time) WHERE candidate_day_id IS NOT NULL
      DO UPDATE SET retired_at=NULL WHERE public.event_dates.retired_at IS NOT NULL;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.event_dates a JOIN public.event_dates b
    ON a.event_id=b.event_id AND a.candidate_day_id=b.candidate_day_id AND a.id<b.id
    WHERE a.event_id=e.id AND a.retired_at IS NULL AND b.retired_at IS NULL
      AND a.start_time<b.end_time AND a.end_time>b.start_time)
    THEN RAISE EXCEPTION 'overlapping_slots'; END IF;
  SELECT count(*) INTO total_count FROM public.event_dates WHERE event_id=e.id;
  IF total_count>12000 OR (SELECT count(*) FROM public.event_dates
    WHERE event_id=e.id AND retired_at IS NULL)>3000 THEN RAISE EXCEPTION 'limit_exceeded'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.event_candidate_days WHERE event_id=e.id AND confirmed_at IS NOT NULL)
    THEN UPDATE public.event_candidate_days SET prefinal_time_target=true WHERE id=c.id; END IF;
  after_state:=jsonb_build_object('stage','times','target',
    (SELECT prefinal_time_target FROM public.event_candidate_days WHERE id=c.id),
    'slots',(SELECT jsonb_agg(jsonb_build_array(id,retired_at IS NOT NULL) ORDER BY id)
      FROM public.event_dates WHERE event_id=e.id));
  UPDATE public.events SET revision=revision+CASE WHEN before_state IS DISTINCT FROM after_state OR cardinality(removed)>0 THEN 1 ELSE 0 END,
    adjustment_stage='times' WHERE id=e.id RETURNING revision INTO e.revision;
  SET CONSTRAINTS ALL IMMEDIATE;
  RETURN e.revision;
END $$;

CREATE FUNCTION date_first.answer_snapshot(p_participant uuid,p_kind text) RETURNS jsonb
LANGUAGE sql SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object('name',p.name,'answers',
    CASE WHEN p_kind='days' THEN
      (SELECT jsonb_agg(jsonb_build_array(r.candidate_day_id,r.status,r.source,r.comment,
        (SELECT jsonb_agg(jsonb_build_array(i.start_offset_minutes,i.end_offset_minutes)
          ORDER BY i.start_offset_minutes) FROM public.day_response_intervals i WHERE i.day_response_id=r.id))
        ORDER BY r.candidate_day_id) FROM public.event_day_responses r WHERE r.participant_id=p.id)
    ELSE
      (SELECT jsonb_agg(jsonb_build_array(r.event_date_id,r.availability,r.source)
        ORDER BY r.event_date_id) FROM public.date_first_time_responses r WHERE r.participant_id=p.id)
    END) FROM public.participants p WHERE p.id=p_participant
$$;

CREATE FUNCTION date_first.save_answers(p_token text,p_participant uuid,p_revision bigint,
  p_kind text,p_changes jsonb,p_name text DEFAULT NULL,p_expected_name text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE e public.events; p public.participants; x jsonb; d public.event_candidate_days;
  t public.event_dates; r public.event_day_responses; st text; origin text; cm text;
  current_revision bigint; rg int4range; changed boolean; before_state jsonb;
BEGIN
  PERFORM date_first.validate_changes(p_kind,p_changes);
  IF p_revision IS NULL OR p_revision<0 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_name IS NOT NULL AND char_length(btrim(p_name)) NOT BETWEEN 1 AND 100
    THEN RAISE EXCEPTION 'invalid_input'; END IF;
  SELECT * INTO STRICT e FROM public.events
    WHERE public_token=p_token AND scheduling_mode='date_first' FOR SHARE;
  SELECT * INTO STRICT p FROM public.participants WHERE id=p_participant AND event_id=e.id FOR UPDATE;
  IF p_kind IS NULL OR p_kind NOT IN ('days','times') THEN RAISE EXCEPTION 'invalid_input'; END IF;
  current_revision:=CASE WHEN p_kind='days' THEN p.day_answers_revision ELSE p.detail_answers_revision END;
  IF p_revision<>current_revision THEN RAISE EXCEPTION 'stale_revision'; END IF;
  before_state:=date_first.answer_snapshot(p.id,p_kind);
  IF p_name IS NOT NULL THEN
    IF p_expected_name IS NULL OR p.name<>p_expected_name THEN RAISE EXCEPTION 'stale_name'; END IF;
    UPDATE public.participants SET name=btrim(p_name) WHERE id=p.id;
  END IF;
  IF jsonb_array_length(p_changes)<>(SELECT count(DISTINCT value->>'id')
    FROM jsonb_array_elements(p_changes)) THEN RAISE EXCEPTION 'invalid_input'; END IF;
  FOR x IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
    IF p_kind='days' THEN
      SELECT * INTO STRICT d FROM public.event_candidate_days WHERE id=(x->>'id')::uuid AND event_id=e.id;
      SELECT * INTO r FROM public.event_day_responses WHERE participant_id=p.id AND candidate_day_id=d.id;
      st:=CASE WHEN x?'status' THEN x->>'status' ELSE r.status END;
      origin:=CASE WHEN x?'status' OR x?'intervals' THEN 'manual' ELSE r.source END;
      cm:=CASE WHEN x?'comment' THEN nullif(x->>'comment','') ELSE r.comment END;
      IF st IS NULL AND NOT(x?'status') AND cm IS NOT NULL THEN RAISE EXCEPTION 'invalid_input'; END IF;
      IF st IS NULL THEN cm:=NULL; END IF;
      IF x?'intervals' AND jsonb_array_length(x->'intervals')>900
        THEN RAISE EXCEPTION 'limit_exceeded'; END IF;
      IF st IS DISTINCT FROM 'maybe' AND x?'intervals'
        AND jsonb_array_length(x->'intervals')>0 THEN RAISE EXCEPTION 'invalid_input'; END IF;
      -- 値のないコメント操作だけでは、未登録の日付を手動保護へ変えない。
      IF r.id IS NULL AND NOT(x?'status' OR x?'intervals') AND cm IS NULL THEN CONTINUE; END IF;
      INSERT INTO public.event_day_responses(event_id,participant_id,candidate_day_id,status,source,comment)
        VALUES(e.id,p.id,d.id,st,coalesce(origin,'manual'),cm)
        ON CONFLICT (participant_id,candidate_day_id) DO UPDATE SET
          status=excluded.status,source=excluded.source,comment=excluded.comment
        RETURNING * INTO r;
      IF st IS DISTINCT FROM 'maybe' OR x?'intervals' THEN
        DELETE FROM public.day_response_intervals WHERE day_response_id=r.id;
      END IF;
      IF st='maybe' AND x?'intervals' THEN
        FOR rg IN SELECT unnest(range_agg(int4range((z->>0)::integer,(z->>1)::integer,'[)')))
          FROM jsonb_array_elements(x->'intervals') z LOOP
          INSERT INTO public.day_response_intervals(day_response_id,start_offset_minutes,end_offset_minutes)
            VALUES(r.id,lower(rg),upper(rg));
        END LOOP;
      END IF;
    ELSE
      SELECT * INTO STRICT t FROM public.event_dates WHERE id=(x->>'id')::uuid AND event_id=e.id
        AND retired_at IS NULL;
      IF NOT EXISTS(SELECT 1 FROM public.event_candidate_days WHERE id=t.candidate_day_id
        AND event_id=e.id AND CASE WHEN EXISTS(
          SELECT 1 FROM public.event_candidate_days WHERE event_id=e.id AND confirmed_at IS NOT NULL)
          THEN confirmed_at IS NOT NULL ELSE prefinal_time_target END)
        THEN RAISE EXCEPTION 'invalid_event_scope'; END IF;
      INSERT INTO public.date_first_time_responses(event_id,participant_id,event_date_id,availability,source)
        VALUES(e.id,p.id,t.id,(x->>'availability')::boolean,'manual')
        ON CONFLICT (participant_id,event_date_id) DO UPDATE SET
          availability=excluded.availability,source='manual';
    END IF;
  END LOOP;
  changed:=before_state IS DISTINCT FROM date_first.answer_snapshot(p.id,p_kind);
  IF changed THEN
    IF p_kind='days' THEN
      UPDATE public.participants SET day_answers_revision=day_answers_revision+1 WHERE id=p.id
        RETURNING day_answers_revision INTO current_revision;
    ELSE
      UPDATE public.participants SET detail_answers_revision=detail_answers_revision+1 WHERE id=p.id
        RETURNING detail_answers_revision INTO current_revision;
    END IF;
  END IF;
  SET CONSTRAINTS ALL IMMEDIATE;
  RETURN current_revision;
END $$;

CREATE FUNCTION date_first.finalize(p_token text,p_revision bigint,p_days uuid[],p_times uuid[],
  p_ack uuid[] DEFAULT '{}') RETURNS bigint
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE e public.events; removed uuid[];
BEGIN
  IF p_revision IS NULL OR p_revision<0 OR p_ack IS NULL
    OR cardinality(p_ack)<>(SELECT count(DISTINCT x) FROM unnest(p_ack) x)
    THEN RAISE EXCEPTION 'invalid_input'; END IF;
  SELECT * INTO STRICT e FROM public.events
    WHERE public_token=p_token AND scheduling_mode='date_first' FOR UPDATE;
  IF e.revision<>p_revision THEN RAISE EXCEPTION 'stale_revision'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_days) x WHERE NOT EXISTS(
    SELECT 1 FROM public.event_candidate_days WHERE id=x AND event_id=e.id))
    OR EXISTS(SELECT 1 FROM unnest(p_times) x WHERE NOT EXISTS(
      SELECT 1 FROM public.event_dates WHERE id=x AND event_id=e.id
        AND retired_at IS NULL AND candidate_day_id=ANY(p_days)))
    THEN RAISE EXCEPTION 'invalid_event_scope'; END IF;
  IF p_days IS NULL OR p_times IS NULL OR cardinality(p_days)<>(SELECT count(DISTINCT x) FROM unnest(p_days) x)
    OR cardinality(p_times)<>(SELECT count(DISTINCT x) FROM unnest(p_times) x)
    THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF (SELECT coalesce(array_agg(id ORDER BY id),'{}') FROM public.event_candidate_days WHERE event_id=e.id AND confirmed_at IS NOT NULL)
    =(SELECT coalesce(array_agg(x ORDER BY x),'{}') FROM unnest(p_days) x)
    AND (SELECT coalesce(array_agg(event_date_id ORDER BY event_date_id),'{}') FROM public.finalized_dates WHERE event_id=e.id)
    =(SELECT coalesce(array_agg(x ORDER BY x),'{}') FROM unnest(p_times) x)
    THEN RETURN e.revision; END IF;
  SELECT coalesce(array_agg(event_date_id ORDER BY event_date_id),'{}') INTO removed
    FROM public.finalized_dates WHERE event_id=e.id AND NOT(event_date_id=ANY(p_times));
  IF removed<>(SELECT coalesce(array_agg(x ORDER BY x),'{}') FROM unnest(p_ack) x)
    THEN RAISE EXCEPTION 'requires_confirmation'; END IF;
  DELETE FROM public.finalized_dates WHERE event_id=e.id;
  UPDATE public.event_candidate_days SET confirmed_at=CASE WHEN id=ANY(p_days)
    THEN coalesce(confirmed_at,now()) ELSE NULL END,
    prefinal_time_target=CASE WHEN cardinality(p_days)>0 THEN false ELSE prefinal_time_target END
    WHERE event_id=e.id;
  INSERT INTO public.finalized_dates(event_id,event_date_id) SELECT e.id,x FROM unnest(p_times) x;
  UPDATE public.events SET revision=revision+1,is_finalized=cardinality(p_days)>0,final_date_id=NULL
    WHERE id=e.id RETURNING revision INTO e.revision;
  SET CONSTRAINTS ALL IMMEDIATE;
  RETURN e.revision;
END $$;

-- 旧回答RPCへの流入だけを防ぐラッパー。旧方式の呼び出し契約は維持する。
ALTER FUNCTION public.update_participant_availability(uuid,uuid,jsonb) SET SCHEMA date_first;
CREATE FUNCTION public.update_participant_availability(p_participant_id uuid,p_event_id uuid,p_availabilities jsonb)
RETURNS boolean LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.events WHERE id=p_event_id AND scheduling_mode='time_first')
    THEN RAISE EXCEPTION 'invalid_mode'; END IF;
  RETURN date_first.update_participant_availability(p_participant_id,p_event_id,p_availabilities);
END $$;

ALTER FUNCTION public.finalize_event_safe(uuid,jsonb) SET SCHEMA date_first;
CREATE FUNCTION public.finalize_event_safe(p_event_id uuid,p_date_ids jsonb)
RETURNS boolean LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.events WHERE id=p_event_id AND scheduling_mode='time_first')
    THEN RAISE EXCEPTION 'invalid_mode'; END IF;
  RETURN date_first.finalize_event_safe(p_event_id,p_date_ids);
END $$;
REVOKE ALL ON FUNCTION public.finalize_event_safe(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_event_safe(uuid,jsonb) TO service_role;


-- 本人リンクと予定反映を、同じSQLトランザクションで検証する。
CREATE FUNCTION date_first.my_answer(p_user text,p_token text,p_kind text,p_revision bigint,
  p_changes jsonb,p_request uuid DEFAULT NULL,p_name text DEFAULT NULL,p_use_account boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE e uuid; participant uuid; existing public.participants; body jsonb; new_revision bigint; created boolean; preview jsonb;
BEGIN
  IF p_use_account IS NULL THEN RAISE EXCEPTION 'invalid_input'; END IF;
  PERFORM date_first.validate_changes(p_kind,p_changes);
  PERFORM pg_advisory_xact_lock(hashtextextended('daysynth-user:'||p_user,0));
  IF NOT EXISTS(SELECT 1 FROM authjs.users WHERE id=p_user) THEN RAISE EXCEPTION 'invalid_identity'; END IF;
  SELECT id INTO STRICT e FROM public.events WHERE public_token=p_token
    AND scheduling_mode='date_first' FOR SHARE;
  SELECT l.participant_id INTO participant FROM public.user_event_links l
    WHERE l.user_id=p_user AND l.event_id=e FOR UPDATE;
  body:=jsonb_build_object('name',p_name,'user',p_user,'kind',p_kind,'changes',p_changes,'use_account',p_use_account);
  IF p_request IS NOT NULL AND participant IS NOT NULL THEN
    SELECT * INTO STRICT existing FROM public.participants WHERE id=participant AND event_id=e;
    IF existing.creation_request_id IS DISTINCT FROM p_request
      OR existing.creation_payload_hash IS DISTINCT FROM encode(sha256(convert_to(body::text,'UTF8')),'hex')
    THEN RAISE EXCEPTION 'request_conflict'; END IF;
    RETURN jsonb_build_object('id',participant,'replayed',true,
      'revision',CASE WHEN p_kind='days' THEN existing.day_answers_revision ELSE existing.detail_answers_revision END::text);
  END IF;
  created:=participant IS NULL;
  IF NOT created AND (p_name IS NOT NULL OR p_use_account) THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF participant IS NULL THEN
    IF p_request IS NULL OR p_name IS NULL THEN RAISE EXCEPTION 'not_linked'; END IF;
    participant:=date_first.create_participant(p_token,p_request,body);
    INSERT INTO public.user_event_links(user_id,event_id,participant_id) VALUES(p_user,e,participant)
      ON CONFLICT(user_id,event_id) DO UPDATE SET participant_id=excluded.participant_id,updated_at=now()
      WHERE public.user_event_links.participant_id IS NULL;
  ELSIF NOT EXISTS(SELECT 1 FROM public.participants WHERE id=participant AND event_id=e)
    THEN RAISE EXCEPTION 'invalid_event_scope';
  END IF;
  new_revision:=date_first.save_answers(p_token,participant,p_revision,p_kind,p_changes);
  IF created AND p_use_account THEN
    preview:=date_first.sync_preview(p_user,p_token);
    PERFORM date_first.apply_sync(p_user,p_token,preview->>'fingerprint');
    SELECT CASE WHEN p_kind='days' THEN day_answers_revision ELSE detail_answers_revision END
      INTO new_revision FROM public.participants WHERE id=participant;
  END IF;
  RETURN jsonb_build_object('id',participant,'revision',new_revision::text,'replayed',false,'created',created);
END $$;

-- 既知の可区間から不可と他イベントの確定日時を差し引く。未登録は可にしない。
CREATE FUNCTION date_first.schedule_ranges(p_user text,p_event uuid,p_start timestamp,p_end timestamp,p_proposed jsonb DEFAULT '[]')
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE free_ranges tsmultirange; busy_ranges tsmultirange; window_range tsrange;
BEGIN
  window_range:=tsrange(p_start,p_end,'[)');
  WITH inputs AS (
    SELECT start_time AT TIME ZONE 'UTC' AS lo,end_time AT TIME ZONE 'UTC' AS hi,availability AS available
      FROM public.user_schedule_blocks b WHERE user_id=p_user AND NOT EXISTS(
        SELECT 1 FROM jsonb_to_recordset(p_proposed) AS proposed(start_time timestamp,end_time timestamp,availability boolean)
        WHERE proposed.start_time=b.start_time AT TIME ZONE 'UTC' AND proposed.end_time=b.end_time AT TIME ZONE 'UTC')
    UNION ALL
    SELECT start_time,end_time,availability FROM jsonb_to_recordset(p_proposed)
      AS proposed(start_time timestamp,end_time timestamp,availability boolean)
    UNION ALL
    SELECT d.start_time,d.end_time,false FROM public.user_event_links l
      JOIN public.finalized_dates f ON f.event_id=l.event_id
      JOIN public.event_dates d ON d.id=f.event_date_id AND d.event_id=f.event_id
      WHERE l.user_id=p_user AND f.event_id<>p_event
  ), clipped AS (
    SELECT tsrange(greatest(lo,p_start),least(hi,p_end),'[)') AS value,available
    FROM inputs WHERE lo<p_end AND hi>p_start
  )
  SELECT coalesce(range_agg(value) FILTER(WHERE available),'{}'::tsmultirange),
    coalesce(range_agg(value) FILTER(WHERE NOT available),'{}'::tsmultirange)
    INTO free_ranges,busy_ranges FROM clipped;
  free_ranges:=free_ranges-busy_ranges;
  RETURN jsonb_build_object('full_available',free_ranges @> window_range,
    'full_unavailable',busy_ranges @> window_range,
    'has_available',free_ranges<>'{}'::tsmultirange,
    'has_busy',busy_ranges<>'{}'::tsmultirange,
    'free',coalesce((SELECT jsonb_agg(jsonb_build_array(lower(r),upper(r)) ORDER BY lower(r))
      FROM unnest(free_ranges) r),'[]'::jsonb));
END $$;

CREATE FUNCTION date_first.sync_preview(p_user text,p_token text,p_proposed jsonb DEFAULT '[]',p_allow_new boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public,pg_temp SET timezone='UTC' AS $$
DECLARE e public.events; participant uuid; v_candidate record; v_slot record; old_day public.event_day_responses;
  coverage jsonb; extended jsonb; patch jsonb; day_changes jsonb:='[]'; time_changes jsonb:='[]';
  cleared jsonb:='[]'; state jsonb; status_value text; slot_value boolean; intervals jsonb; z jsonb;
  lo numeric; hi numeric;
BEGIN
  SELECT * INTO STRICT e FROM public.events WHERE public_token=p_token AND scheduling_mode='date_first';
  SELECT p.id INTO participant FROM public.user_event_links l
    JOIN public.participants p ON p.id=l.participant_id AND p.event_id=l.event_id
    WHERE l.user_id=p_user AND l.event_id=e.id;
  IF participant IS NULL AND NOT p_allow_new THEN RAISE EXCEPTION 'not_linked'; END IF;
  FOR v_candidate IN SELECT * FROM public.event_candidate_days WHERE event_id=e.id
    AND local_date::timestamp+interval '24 hours'>now() AT TIME ZONE 'Asia/Tokyo'
    ORDER BY local_date,id LOOP
    SELECT * INTO old_day FROM public.event_day_responses
      WHERE participant_id=participant AND candidate_day_id=v_candidate.id;
    IF old_day.source='manual' THEN CONTINUE; END IF;
    coverage:=date_first.schedule_ranges(p_user,e.id,v_candidate.local_date::timestamp,v_candidate.local_date::timestamp+interval '24 hours',p_proposed);
    status_value:=CASE WHEN (coverage->>'full_available')::boolean THEN 'yes'
      WHEN (coverage->>'full_unavailable')::boolean THEN 'no'
      WHEN (coverage->>'has_available')::boolean THEN 'maybe' ELSE NULL END;
    intervals:='[]';
    IF status_value='maybe' THEN
      extended:=date_first.schedule_ranges(p_user,e.id,v_candidate.local_date::timestamp,v_candidate.local_date::timestamp+interval '30 hours',p_proposed);
      FOR z IN SELECT value FROM jsonb_array_elements(extended->'free') LOOP
        lo:=extract(epoch FROM ((z->>0)::timestamp-v_candidate.local_date::timestamp))/60;
        hi:=extract(epoch FROM ((z->>1)::timestamp-v_candidate.local_date::timestamp))/60;
        IF lo<>trunc(lo) OR hi<>trunc(hi) THEN RAISE EXCEPTION 'unsupported_precision'; END IF;
        intervals:=intervals||jsonb_build_array(jsonb_build_array(lo::integer,hi::integer));
      END LOOP;
    END IF;
    IF status_value IS NULL AND old_day.comment IS NOT NULL THEN
      cleared:=cleared||jsonb_build_array(v_candidate.id);
    END IF;
    day_changes:=day_changes||jsonb_build_array(jsonb_build_object('id',v_candidate.id,'status',status_value,'intervals',intervals));
  END LOOP;
  FOR v_slot IN SELECT d.* FROM public.event_dates d
    JOIN public.event_candidate_days target_day ON target_day.id=d.candidate_day_id
    WHERE d.event_id=e.id AND d.retired_at IS NULL
      AND d.end_time>now() AT TIME ZONE 'Asia/Tokyo'
      AND CASE WHEN EXISTS(SELECT 1 FROM public.event_candidate_days
        WHERE event_id=e.id AND confirmed_at IS NOT NULL)
        THEN target_day.confirmed_at IS NOT NULL ELSE target_day.prefinal_time_target END
      AND NOT EXISTS(SELECT 1 FROM public.date_first_time_responses a
        WHERE a.participant_id=participant AND a.event_date_id=d.id AND a.source='manual')
    ORDER BY d.start_time,d.id LOOP
    coverage:=date_first.schedule_ranges(p_user,e.id,v_slot.start_time,v_slot.end_time,p_proposed);
    slot_value:=CASE WHEN (coverage->>'has_busy')::boolean THEN false
      WHEN (coverage->>'full_available')::boolean THEN true ELSE NULL END;
    time_changes:=time_changes||jsonb_build_array(jsonb_build_object('id',v_slot.id,'availability',slot_value));
  END LOOP;
  state:=jsonb_build_object('user',p_user,'participant',participant,'event_revision',e.revision,
    'day_answers',date_first.answer_snapshot(participant,'days'),
    'time_answers',date_first.answer_snapshot(participant,'times'),
    'day_changes',day_changes,'time_changes',time_changes,
    'slots',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM public.event_dates d WHERE d.event_id=e.id),
    'days',(SELECT jsonb_agg(to_jsonb(state_day) ORDER BY state_day.id) FROM public.event_candidate_days state_day WHERE state_day.event_id=e.id),
    -- 予定更新の事前確認と保存後を同じ論理状態で比較し、行ID・更新日時の違いだけでは失効させない。
    'blocks',(SELECT jsonb_agg(jsonb_build_array(projected.lo,projected.hi,projected.availability) ORDER BY projected.lo,projected.hi,projected.availability) FROM (
      SELECT b.start_time AT TIME ZONE 'UTC' lo,b.end_time AT TIME ZONE 'UTC' hi,b.availability
      FROM public.user_schedule_blocks b WHERE b.user_id=p_user AND NOT EXISTS(
        SELECT 1 FROM jsonb_to_recordset(p_proposed) x(start_time timestamp,end_time timestamp,availability boolean)
        WHERE x.start_time=b.start_time AT TIME ZONE 'UTC' AND x.end_time=b.end_time AT TIME ZONE 'UTC')
      UNION ALL SELECT start_time,end_time,availability FROM jsonb_to_recordset(p_proposed)
        x(start_time timestamp,end_time timestamp,availability boolean)) projected),
    'busy',(SELECT jsonb_agg(jsonb_build_array(f.event_id,f.event_date_id,d.start_time,d.end_time) ORDER BY f.id)
      FROM public.user_event_links l JOIN public.finalized_dates f ON f.event_id=l.event_id
      JOIN public.event_dates d ON d.id=f.event_date_id AND d.event_id=f.event_id WHERE l.user_id=p_user));
  RETURN jsonb_build_object('participant',participant,'days',day_changes,'times',time_changes,
    'cleared_comments',cleared,'fingerprint',encode(sha256(convert_to(state::text,'UTF8')),'hex'));
END $$;

CREATE FUNCTION date_first.apply_sync(p_user text,p_token text,p_fingerprint text,
  p_ack uuid[] DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE e uuid; participant uuid; preview jsonb; x jsonb; r public.event_day_responses;
  before_day jsonb; before_time jsonb; cleared uuid[];
BEGIN
  IF current_setting('transaction_isolation')<>'serializable' THEN
    RAISE EXCEPTION 'serializable_required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('daysynth-user:'||p_user,0));
  SELECT id INTO STRICT e FROM public.events WHERE public_token=p_token AND scheduling_mode='date_first' FOR SHARE;
  SELECT participant_id INTO participant FROM public.user_event_links
    WHERE user_id=p_user AND event_id=e FOR UPDATE;
  IF participant IS NULL THEN RAISE EXCEPTION 'not_linked'; END IF;
  PERFORM 1 FROM public.participants WHERE id=participant AND event_id=e FOR UPDATE;
  preview:=date_first.sync_preview(p_user,p_token);
  IF preview->>'fingerprint' IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'stale_preview'; END IF;
  SELECT coalesce(array_agg(value::uuid ORDER BY value::uuid),'{}') INTO cleared
    FROM jsonb_array_elements_text(preview->'cleared_comments');
  IF cleared<>(SELECT coalesce(array_agg(acknowledged_id ORDER BY acknowledged_id),'{}') FROM unnest(p_ack) AS ack(acknowledged_id))
    THEN RAISE EXCEPTION 'requires_confirmation'; END IF;
  before_day:=date_first.answer_snapshot(participant,'days');
  before_time:=date_first.answer_snapshot(participant,'times');
  FOR x IN SELECT value FROM jsonb_array_elements(preview->'days') LOOP
    IF x->>'status' IS NULL THEN
      DELETE FROM public.event_day_responses WHERE participant_id=participant
        AND candidate_day_id=(x->>'id')::uuid AND source='account';
    ELSE
      INSERT INTO public.event_day_responses(event_id,participant_id,candidate_day_id,status,source,comment)
        VALUES(e,participant,(x->>'id')::uuid,x->>'status','account',NULL)
        ON CONFLICT (participant_id,candidate_day_id) DO UPDATE SET status=excluded.status
        RETURNING * INTO r;
      DELETE FROM public.day_response_intervals WHERE day_response_id=r.id;
      INSERT INTO public.day_response_intervals(day_response_id,start_offset_minutes,end_offset_minutes)
        SELECT r.id,(v->>0)::integer,(v->>1)::integer FROM jsonb_array_elements(x->'intervals') v;
    END IF;
  END LOOP;
  FOR x IN SELECT value FROM jsonb_array_elements(preview->'times') LOOP
    IF x->>'availability' IS NULL THEN
      DELETE FROM public.date_first_time_responses WHERE participant_id=participant
        AND event_date_id=(x->>'id')::uuid AND source='account';
    ELSE
      INSERT INTO public.date_first_time_responses(event_id,participant_id,event_date_id,availability,source)
        VALUES(e,participant,(x->>'id')::uuid,(x->>'availability')::boolean,'account')
        ON CONFLICT (participant_id,event_date_id) DO UPDATE SET availability=excluded.availability;
    END IF;
  END LOOP;
  UPDATE public.participants SET
    day_answers_revision=day_answers_revision+
      CASE WHEN before_day IS DISTINCT FROM date_first.answer_snapshot(participant,'days') THEN 1 ELSE 0 END,
    detail_answers_revision=detail_answers_revision+
      CASE WHEN before_time IS DISTINCT FROM date_first.answer_snapshot(participant,'times') THEN 1 ELSE 0 END
    WHERE id=participant;
  SET CONSTRAINTS ALL IMMEDIATE;
  RETURN jsonb_build_object('participant',participant,'success',true);
END $$;

-- 公開トークンの範囲だけを返し、作成要求やhashなどの内部値を転送しない。
CREATE FUNCTION date_first.read_event(p_token text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
SELECT jsonb_build_object(
  'event',jsonb_build_object('id',e.id,'title',e.title,'description',e.description,
    'token',e.public_token,'stage',e.adjustment_stage,'revision',e.revision::text,
    'baseRanges',coalesce(e.base_time_ranges,'[[600,1320]]'::jsonb)),
  'participants',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name)
    ORDER BY p.created_at,p.id) FROM public.participants p WHERE p.event_id=e.id),'[]'::jsonb),
  'days',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'date',c.local_date::text,
    'confirmed',c.confirmed_at IS NOT NULL,'target',CASE WHEN EXISTS(
      SELECT 1 FROM public.event_candidate_days WHERE event_id=e.id AND confirmed_at IS NOT NULL)
      THEN c.confirmed_at IS NOT NULL ELSE c.prefinal_time_target END,
    'yes',(SELECT count(*) FROM public.event_day_responses r WHERE r.candidate_day_id=c.id AND r.status='yes'),
    'maybe',(SELECT count(*) FROM public.event_day_responses r WHERE r.candidate_day_id=c.id AND r.status='maybe'),
    'no',(SELECT count(*) FROM public.event_day_responses r WHERE r.candidate_day_id=c.id AND r.status='no'),
    'unanswered',(SELECT count(*) FROM public.participants p WHERE p.event_id=e.id)-
      (SELECT count(*) FROM public.event_day_responses r WHERE r.candidate_day_id=c.id AND r.status IS NOT NULL),
    'hasComment',EXISTS(SELECT 1 FROM public.event_day_responses r
      WHERE r.candidate_day_id=c.id AND r.status IS NOT NULL AND r.comment ~ '[^[:space:]　]')
    ) ORDER BY c.local_date,c.id) FROM public.event_candidate_days c WHERE c.event_id=e.id),'[]'::jsonb),
  'slots',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'dayId',d.candidate_day_id,
    'start',extract(epoch FROM(d.start_time-c.local_date::timestamp))::integer/60,
    'end',extract(epoch FROM(d.end_time-c.local_date::timestamp))::integer/60,
    'finalized',EXISTS(SELECT 1 FROM public.finalized_dates f WHERE f.event_date_id=d.id AND f.event_id=e.id),
    'yes',(SELECT count(*) FROM public.date_first_time_responses r WHERE r.event_date_id=d.id AND r.availability IS TRUE),
    'no',(SELECT count(*) FROM public.date_first_time_responses r WHERE r.event_date_id=d.id AND r.availability IS FALSE),
    'unanswered',(SELECT count(*) FROM public.participants p WHERE p.event_id=e.id)-
      (SELECT count(*) FROM public.date_first_time_responses r WHERE r.event_date_id=d.id AND r.availability IS NOT NULL)
    ) ORDER BY d.start_time,d.end_time,d.id)
    FROM public.event_dates d JOIN public.event_candidate_days c ON c.id=d.candidate_day_id
    WHERE d.event_id=e.id AND d.retired_at IS NULL AND CASE WHEN EXISTS(
      SELECT 1 FROM public.event_candidate_days WHERE event_id=e.id AND confirmed_at IS NOT NULL)
      THEN c.confirmed_at IS NOT NULL ELSE c.prefinal_time_target END),'[]'::jsonb)
) FROM public.events e WHERE e.public_token=p_token AND e.scheduling_mode='date_first'
$$;

CREATE FUNCTION date_first.read_answer(p_token text,p_participant uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
SELECT jsonb_build_object('id',p.id,'name',p.name,'dayRevision',p.day_answers_revision::text,
  'timeRevision',p.detail_answers_revision::text,
  'days',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.candidate_day_id,'status',r.status,
    'source',r.source,'comment',r.comment,'intervals',coalesce((SELECT
      jsonb_agg(jsonb_build_array(i.start_offset_minutes,i.end_offset_minutes) ORDER BY i.start_offset_minutes)
      FROM public.day_response_intervals i WHERE i.day_response_id=r.id),'[]'::jsonb)) ORDER BY r.candidate_day_id)
    FROM public.event_day_responses r WHERE r.participant_id=p.id),'[]'::jsonb),
  'times',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.event_date_id,'availability',r.availability,'source',r.source)
    ORDER BY r.event_date_id) FROM public.date_first_time_responses r
    JOIN public.event_dates d ON d.id=r.event_date_id
    JOIN public.event_candidate_days c ON c.id=d.candidate_day_id
    WHERE r.participant_id=p.id AND d.retired_at IS NULL AND CASE WHEN EXISTS(
      SELECT 1 FROM public.event_candidate_days WHERE event_id=e.id AND confirmed_at IS NOT NULL)
      THEN c.confirmed_at IS NOT NULL ELSE c.prefinal_time_target END),'[]'::jsonb)
) FROM public.participants p JOIN public.events e ON e.id=p.event_id
WHERE e.public_token=p_token AND e.scheduling_mode='date_first' AND p.id=p_participant
$$;

CREATE FUNCTION date_first.day_details(p_token text,p_day uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'status',r.status,'comment',r.comment,
  'intervals',coalesce((SELECT jsonb_agg(jsonb_build_array(i.start_offset_minutes,i.end_offset_minutes)
    ORDER BY i.start_offset_minutes) FROM public.day_response_intervals i WHERE i.day_response_id=r.id),'[]'::jsonb))
  ORDER BY CASE r.status WHEN 'yes' THEN 0 WHEN 'maybe' THEN 1 WHEN 'no' THEN 2 ELSE 3 END,p.created_at,p.id),'[]'::jsonb)
FROM public.events e JOIN public.event_candidate_days c ON c.event_id=e.id
JOIN public.participants p ON p.event_id=e.id
LEFT JOIN public.event_day_responses r ON r.participant_id=p.id AND r.candidate_day_id=c.id
WHERE e.public_token=p_token AND e.scheduling_mode='date_first' AND c.id=p_day
$$;

CREATE FUNCTION date_first.web_answer(p_token text,p_request uuid,p_kind text,p_changes jsonb,p_name text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE e uuid; participant uuid; existing public.participants; body jsonb; rev bigint;
BEGIN
  PERFORM date_first.validate_changes(p_kind,p_changes);
  SELECT id INTO STRICT e FROM public.events WHERE public_token=p_token AND scheduling_mode='date_first' FOR SHARE;
  body:=jsonb_build_object('name',p_name,'kind',p_kind,'changes',p_changes);
  -- 要求単位のロックで、並行再送を二重保存にしない。
  PERFORM pg_advisory_xact_lock(hashtextextended('date-first-create:'||e::text||':'||p_request::text,0));
  SELECT * INTO existing FROM public.participants WHERE event_id=e AND creation_request_id=p_request;
  IF existing.id IS NOT NULL THEN
    IF existing.creation_payload_hash<>encode(sha256(convert_to(body::text,'UTF8')),'hex')
      THEN RAISE EXCEPTION 'request_conflict'; END IF;
    RETURN jsonb_build_object('id',existing.id,'replayed',true);
  END IF;
  participant:=date_first.create_participant(p_token,p_request,body);
  rev:=date_first.save_answers(p_token,participant,0,p_kind,p_changes);
  RETURN jsonb_build_object('id',participant,'revision',rev::text,'replayed',false);
END $$;

-- 本人の正式な時間回答だけを予定へ写す。未回答・日付記号から予定を作らない。
CREATE FUNCTION date_first.answer_schedule_preview(p_user text,p_token text,p_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public,pg_temp SET timezone='UTC' AS $$
DECLARE e public.events; participant uuid; available tsmultirange; busy tsmultirange; selected_ranges tsmultirange;
  blocks jsonb; preserved jsonb; overwritten jsonb; unanswered jsonb; state jsonb;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 3000
    OR cardinality(p_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_ids) x)
    THEN RAISE EXCEPTION 'invalid_input'; END IF;
  SELECT * INTO STRICT e FROM public.events WHERE public_token=p_token AND scheduling_mode='date_first';
  SELECT l.participant_id INTO participant FROM public.user_event_links l JOIN public.participants p
    ON p.id=l.participant_id AND p.event_id=l.event_id WHERE l.user_id=p_user AND l.event_id=e.id;
  IF participant IS NULL THEN RAISE EXCEPTION 'not_linked'; END IF;
  IF (SELECT count(*) FROM public.event_dates d JOIN public.event_candidate_days c ON c.id=d.candidate_day_id
    WHERE d.event_id=e.id AND d.id=ANY(p_ids) AND d.retired_at IS NULL
    AND CASE WHEN EXISTS(SELECT 1 FROM public.event_candidate_days WHERE event_id=e.id AND confirmed_at IS NOT NULL)
      THEN c.confirmed_at IS NOT NULL ELSE c.prefinal_time_target END)<>cardinality(p_ids)
    THEN RAISE EXCEPTION 'invalid_event_scope'; END IF;
  SELECT coalesce(range_agg(tsrange(d.start_time,d.end_time,'[)')) FILTER(WHERE r.availability IS TRUE),'{}'::tsmultirange),
    coalesce(range_agg(tsrange(d.start_time,d.end_time,'[)')) FILTER(WHERE r.availability IS FALSE),'{}'::tsmultirange)
    INTO available,busy FROM public.event_dates d LEFT JOIN public.date_first_time_responses r
    ON r.event_date_id=d.id AND r.participant_id=participant WHERE d.id=ANY(p_ids) AND d.event_id=e.id;
  IF available*busy<>'{}'::tsmultirange THEN RAISE EXCEPTION 'conflicting_answers'; END IF;
  selected_ranges:=available+busy;
  SELECT coalesce(jsonb_agg(jsonb_build_object('start_time',lower(r),'end_time',upper(r),'availability',a) ORDER BY lower(r),upper(r),a),'[]'::jsonb)
    INTO blocks FROM (SELECT unnest(available) r,true a UNION ALL SELECT unnest(busy),false) desired;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'start_time',b.start_time AT TIME ZONE 'UTC',
    'end_time',b.end_time AT TIME ZONE 'UTC','availability',b.availability,'source',b.source,'event_id',b.event_id) ORDER BY b.id),'[]'::jsonb)
    INTO overwritten FROM public.user_schedule_blocks b WHERE b.user_id=p_user
    AND tsrange(b.start_time AT TIME ZONE 'UTC',b.end_time AT TIME ZONE 'UTC','[)')&&selected_ranges;
  SELECT coalesce(jsonb_agg(jsonb_build_object('start_time',lower(r),'end_time',upper(r),'availability',b.availability,
    'source',b.source,'event_id',b.event_id) ORDER BY lower(r),upper(r),b.id),'[]'::jsonb)
    INTO preserved FROM public.user_schedule_blocks b CROSS JOIN LATERAL
    unnest(tsmultirange(tsrange(b.start_time AT TIME ZONE 'UTC',b.end_time AT TIME ZONE 'UTC','[)'))-selected_ranges) r
    WHERE b.user_id=p_user AND tsrange(b.start_time AT TIME ZONE 'UTC',b.end_time AT TIME ZONE 'UTC','[)')&&selected_ranges;
  SELECT coalesce(jsonb_agg(d.id ORDER BY d.id),'[]'::jsonb) INTO unanswered FROM public.event_dates d
    LEFT JOIN public.date_first_time_responses r ON r.event_date_id=d.id AND r.participant_id=participant
    WHERE d.id=ANY(p_ids) AND d.event_id=e.id AND r.availability IS NULL;
  state:=jsonb_build_object('user',p_user,'event',e.id,'event_revision',e.revision,'participant',participant,
    'ids',(SELECT jsonb_agg(x ORDER BY x) FROM unnest(p_ids) x),'answers',date_first.answer_snapshot(participant,'times'),
    'schedule',(SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM public.user_schedule_blocks b WHERE b.user_id=p_user),
    'busy',(SELECT jsonb_agg(jsonb_build_array(f.event_id,f.event_date_id,d.start_time,d.end_time) ORDER BY f.id)
      FROM public.user_event_links l JOIN public.finalized_dates f ON f.event_id=l.event_id
      JOIN public.event_dates d ON d.id=f.event_date_id WHERE l.user_id=p_user));
  RETURN jsonb_build_object('changes',blocks,'preserved',preserved,'overwritten',overwritten,'unanswered_ids',unanswered,
    'expected_revision',encode(sha256(convert_to(state::text,'UTF8')),'hex'));
END $$;

CREATE FUNCTION date_first.apply_answer_schedule(p_user text,p_token text,p_ids uuid[],p_fingerprint text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,pg_temp SET timezone='UTC' AS $$
DECLARE e uuid; participant uuid; plan jsonb;
BEGIN
  IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'serializable_required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('daysynth-user:'||p_user,0));
  SELECT id INTO STRICT e FROM public.events WHERE public_token=p_token AND scheduling_mode='date_first' FOR SHARE;
  SELECT participant_id INTO participant FROM public.user_event_links WHERE user_id=p_user AND event_id=e FOR UPDATE;
  IF participant IS NULL THEN RAISE EXCEPTION 'not_linked'; END IF;
  PERFORM 1 FROM public.participants WHERE id=participant AND event_id=e FOR UPDATE;
  plan:=date_first.answer_schedule_preview(p_user,p_token,p_ids);
  IF plan->>'expected_revision' IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'stale_preview'; END IF;
  DELETE FROM public.user_schedule_blocks WHERE user_id=p_user
    AND id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(plan->'overwritten'));
  -- 選択外の端数を保持する。同一区間の重複は不可を優先し、外側の実効可否を変えない。
  INSERT INTO public.user_schedule_blocks(user_id,start_time,end_time,availability,source,event_id)
    SELECT p_user,x.start_time AT TIME ZONE 'UTC',x.end_time AT TIME ZONE 'UTC',bool_and(x.availability),
      (array_agg(x.source ORDER BY x.availability,x.source,x.event_id))[1],
      (array_agg(x.event_id ORDER BY x.availability,x.source,x.event_id))[1]
    FROM jsonb_to_recordset(plan->'preserved') x(start_time timestamp,end_time timestamp,availability boolean,source text,event_id uuid)
    GROUP BY x.start_time,x.end_time ORDER BY x.start_time,x.end_time
    ON CONFLICT(user_id,start_time,end_time) DO UPDATE SET
      availability=public.user_schedule_blocks.availability AND excluded.availability,
      source=CASE WHEN public.user_schedule_blocks.availability AND NOT excluded.availability THEN excluded.source ELSE public.user_schedule_blocks.source END,
      event_id=CASE WHEN public.user_schedule_blocks.availability AND NOT excluded.availability THEN excluded.event_id ELSE public.user_schedule_blocks.event_id END,
      updated_at=now();
  INSERT INTO public.user_schedule_blocks(user_id,start_time,end_time,availability,source,event_id)
    SELECT p_user,x.start_time AT TIME ZONE 'UTC',x.end_time AT TIME ZONE 'UTC',x.availability,'event',e
    FROM jsonb_to_recordset(plan->'changes') x(start_time timestamp,end_time timestamp,availability boolean)
    ON CONFLICT(user_id,start_time,end_time) DO UPDATE SET
      availability=excluded.availability,source=excluded.source,event_id=excluded.event_id,updated_at=now();
  RETURN jsonb_build_object('saved',true,'saved_slots',jsonb_array_length(plan->'changes'),
    'unanswered_ids',plan->'unanswered_ids','other_events_updated',false);
END $$;

CREATE INDEX ON public.event_day_responses(candidate_day_id,status);
CREATE INDEX ON public.date_first_time_responses(event_date_id,availability);

-- 方式と候補日の基点は、他の保存経路からも変更させない。
CREATE FUNCTION date_first.guard_identity() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='events' THEN
    IF OLD.scheduling_mode IS DISTINCT FROM NEW.scheduling_mode THEN
      RAISE EXCEPTION 'immutable_mode'; END IF;
  ELSE
    IF TG_OP='UPDATE' AND ROW(OLD.event_id,OLD.local_date) IS DISTINCT FROM ROW(NEW.event_id,NEW.local_date)
      THEN RAISE EXCEPTION 'immutable_day'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.events WHERE id=NEW.event_id AND scheduling_mode='date_first')
      THEN RAISE EXCEPTION 'invalid_mode'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER date_first_guard_mode BEFORE UPDATE OF scheduling_mode ON public.events
FOR EACH ROW EXECUTE FUNCTION date_first.guard_identity();
CREATE TRIGGER date_first_guard_day BEFORE INSERT OR UPDATE ON public.event_candidate_days
FOR EACH ROW EXECUTE FUNCTION date_first.guard_identity();

-- 旧boolean回答へ新方式を混入させず、誤った旧経路を原子的に拒否する。
CREATE FUNCTION date_first.guard_legacy_answer() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,pg_temp AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.events WHERE id=NEW.event_id AND scheduling_mode='date_first')
    THEN RAISE EXCEPTION 'invalid_mode'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER date_first_guard_legacy_answer BEFORE INSERT OR UPDATE ON public.availabilities
FOR EACH ROW EXECUTE FUNCTION date_first.guard_legacy_answer();

-- 既存のWeb・MCP予定更新も含め、予定と本人リンクの書き込みを同じ本人ロックへ揃える。
CREATE FUNCTION date_first.lock_user_write() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,pg_temp AS $$
DECLARE owner_id text;
BEGIN
  FOR owner_id IN SELECT DISTINCT x FROM unnest(ARRAY[
    CASE WHEN TG_OP<>'INSERT' THEN OLD.user_id END,
    CASE WHEN TG_OP<>'DELETE' THEN NEW.user_id END]) x WHERE x IS NOT NULL ORDER BY x LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('daysynth-user:'||owner_id,0));
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER date_first_lock_schedule BEFORE INSERT OR UPDATE OR DELETE ON public.user_schedule_blocks
FOR EACH ROW EXECUTE FUNCTION date_first.lock_user_write();
CREATE TRIGGER date_first_lock_link BEFORE INSERT OR UPDATE OR DELETE ON public.user_event_links
FOR EACH ROW EXECUTE FUNCTION date_first.lock_user_write();

ALTER TABLE public.event_candidate_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_day_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.day_response_intervals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.date_first_time_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA date_first FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA date_first TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA date_first FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA date_first TO service_role;
REVOKE ALL ON public.event_candidate_days,public.event_day_responses,
  public.day_response_intervals,public.date_first_time_responses FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.event_candidate_days,public.event_day_responses,
  public.day_response_intervals,public.date_first_time_responses TO service_role;
REVOKE ALL ON FUNCTION public.update_participant_availability(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_participant_availability(uuid,uuid,jsonb) TO service_role;

COMMIT;

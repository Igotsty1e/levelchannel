// Wave 14 #2 — teacher-side dashboard data: list every learner
// assigned to this teacher (or who has any historical slot with
// them) with per-status counts. Used by the cabinet "Мои ученики"
// block.
//
// Why include both assigned + historical: a learner who used to be
// assigned but was reassigned to another teacher should still
// appear in the historical view (so the teacher remembers "I had
// 12 lessons with them"). A newly-assigned learner with zero
// lessons yet should also appear (so the teacher knows to expect
// bookings).

import { getDbPool } from '@/lib/db/pool'

export type TeacherLearnerSummary = {
  learnerId: string
  learnerEmail: string
  displayName: string | null
  isAssigned: boolean
  upcomingCount: number
  completedCount: number
  cancelledCount: number
  noShowCount: number
}

export async function listLearnersForTeacher(
  teacherAccountId: string,
): Promise<TeacherLearnerSummary[]> {
  const pool = getDbPool()
  const result = await pool.query(
    `with stats as (
       select s.learner_account_id as learner_id,
              count(*) filter (where s.status = 'booked' and s.start_at > now())::int as upcoming_count,
              count(*) filter (where s.status = 'completed')::int as completed_count,
              count(*) filter (where s.status = 'cancelled')::int as cancelled_count,
              count(*) filter (where s.status in ('no_show_learner', 'no_show_teacher'))::int as no_show_count
         from lesson_slots s
        where s.teacher_account_id = $1
          and s.learner_account_id is not null
        group by s.learner_account_id
     )
     select a.id as learner_id,
            a.email as learner_email,
            p.display_name,
            (a.assigned_teacher_id = $1) as is_assigned,
            coalesce(st.upcoming_count, 0)::int as upcoming_count,
            coalesce(st.completed_count, 0)::int as completed_count,
            coalesce(st.cancelled_count, 0)::int as cancelled_count,
            coalesce(st.no_show_count, 0)::int as no_show_count
       from accounts a
       left join account_profiles p on p.account_id = a.id
       left join stats st on st.learner_id = a.id
      where a.assigned_teacher_id = $1
         or st.learner_id is not null
      order by is_assigned desc,
               (coalesce(st.upcoming_count, 0) + coalesce(st.completed_count, 0)) desc,
               a.email asc`,
    [teacherAccountId],
  )
  return result.rows.map((row) => ({
    learnerId: String(row.learner_id),
    learnerEmail: String(row.learner_email),
    displayName: row.display_name ? String(row.display_name) : null,
    isAssigned: Boolean(row.is_assigned),
    upcomingCount: Number(row.upcoming_count),
    completedCount: Number(row.completed_count),
    cancelledCount: Number(row.cancelled_count),
    noShowCount: Number(row.no_show_count),
  }))
}

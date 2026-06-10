'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import {
  IssuePackageToLearnerModal,
  type IssuePackageOption,
} from './issue-package-to-learner-modal'
import {
  LearnerPackagesSection,
  type LearnerPackageRow,
} from './learner-packages-section'

// Composition wrapper: list-section + issue-modal singleton. Mounted
// on /teacher/learners/[id]. The modal lives at this level (DSA-R3-3
// singleton ownership pattern) so the section can stay presentational.

export type LearnerPackagesCardProps = {
  teacherId: string
  learnerId: string
  learnerLabel: string
  rows: ReadonlyArray<LearnerPackageRow>
  availablePackages: ReadonlyArray<IssuePackageOption>
}

export function LearnerPackagesCard({
  teacherId,
  learnerId,
  learnerLabel,
  rows,
  availablePackages,
}: LearnerPackagesCardProps) {
  const router = useRouter()
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <>
      <LearnerPackagesSection
        teacherId={teacherId}
        learnerId={learnerId}
        rows={rows}
        teacherHasAnyPackage={availablePackages.length > 0}
        onOpenIssueModal={() => setModalOpen(true)}
      />
      <IssuePackageToLearnerModal
        open={modalOpen}
        learnerId={learnerId}
        learnerLabel={learnerLabel}
        packages={availablePackages}
        onClose={() => setModalOpen(false)}
        onIssued={() => {
          setModalOpen(false)
          router.refresh()
        }}
      />
    </>
  )
}

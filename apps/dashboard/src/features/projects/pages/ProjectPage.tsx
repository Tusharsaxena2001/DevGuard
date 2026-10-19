import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "../../../shared/ui/PageHeader.js";
import { QueryBoundary } from "../../../shared/ui/QueryBoundary.js";
import { StatusBadge } from "../../../shared/ui/StatusBadge.js";
import { useAddCanonicalRepo, useAddDestination, useCanonicalRepos, useDestinations, useProject, useRemoveCanonicalRepo, useRemoveDestination } from "../api/projects.js";
import { FingerprintsSection } from "../components/FingerprintsSection.js";
import { MembersSection } from "../components/MembersSection.js";
import { PolicySection } from "../components/PolicySection.js";
import { UrlListSection } from "../components/UrlListSection.js";

function Detail({ id }: { id: string }): ReactNode {
  const destinations = useDestinations(id);
  const canonical = useCanonicalRepos(id);
  return (
    <div className="space-y-8">
      <UrlListSection
        title="Approved destinations"
        hint="Code from this project may be pushed only to these repositories. Anything else is blocked (or, in audit-only mode, recorded)."
        query={destinations}
        add={useAddDestination(id)}
        remove={useRemoveDestination(id)}
      />
      <UrlListSection
        title="Canonical repositories"
        hint="How laptops recognise this project by its remote. These are also approved destinations."
        query={canonical}
        add={useAddCanonicalRepo(id)}
        remove={useRemoveCanonicalRepo(id)}
      />
      <FingerprintsSection projectId={id} />
    </div>
  );
}

export function ProjectPage(): ReactNode {
  const { id = "" } = useParams();
  const project = useProject(id);
  return (
    <>
      <p className="mb-2 text-sm">
        <Link className="inline-flex min-h-11 items-center text-slate-500 underline lg:min-h-0" to="/projects">
          All projects
        </Link>
      </p>
      <QueryBoundary query={project}>
        {(p) => (
          <>
            <PageHeader title={p.name} subtitle="Protection for this project is configured here; laptops only obey." actions={<StatusBadge value={p.classification} />} />
            <div className="space-y-8">
              <MembersSection project={p} />
              <PolicySection projectId={p.id} />
              <Detail id={p.id} />
            </div>
          </>
        )}
      </QueryBoundary>
    </>
  );
}

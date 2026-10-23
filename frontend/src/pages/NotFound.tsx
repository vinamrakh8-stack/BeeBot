import { Link } from "react-router-dom";
import { EmptyState } from "../components/States";
import { Card } from "../components/ui";

export default function NotFound() {
  return (
    <Card>
      <EmptyState
        title="Page not found"
        description="That route does not exist in Bee Voice+."
        action={
          <Link to="/" className="button secondary">
            Back to overview
          </Link>
        }
      />
    </Card>
  );
}

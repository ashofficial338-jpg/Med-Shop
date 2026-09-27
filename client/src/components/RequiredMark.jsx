// Appended to a <label> to flag a mandatory field, e.g. <label>Name<RequiredMark /></label>
export default function RequiredMark() {
  return (
    <span className="text-danger" aria-hidden="true">
      {" "}
      *
    </span>
  );
}

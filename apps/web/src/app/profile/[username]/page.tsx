import ProfilePage from "@/components/profile/ProfilePage";

/** PROFILE-WALL: чужая страница по адресу /profile/имя. */
export default async function UserProfileRoute({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  return <ProfilePage username={decodeURIComponent(username)} />;
}

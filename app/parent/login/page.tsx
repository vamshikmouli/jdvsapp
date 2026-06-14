import { redirect } from 'next/navigation';

// The login is now unified for all roles at "/". Keep this path working for any
// old links / bookmarks / QR codes by sending them to the single login page.
export default function ParentLoginRedirect() {
  redirect('/');
}

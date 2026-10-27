import { Link, useNavigate } from 'react-router-dom';
import { Breadcrumbs } from '@heroui/react';
import { RouterProvider } from 'react-aria-components';

// Real @heroui/react v3 Breadcrumbs. The Home icon and Back button are app
// extras that sit alongside the stack; the trail itself is the HeroUI
// component (an Item without an href becomes the current page via
// aria-current="page"). Existing call sites keep passing a crumbs array.
export default function AppBreadcrumbs({ crumbs, children, showBack = true, separator = '/', isDisabled = false }) {
  const navigate = useNavigate();
  const goBack = () => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate(crumbs?.[crumbs.length - 2]?.to || '/dashboard');
  };

  let items;
  if (children) {
    items = children;
  } else {
    items = (crumbs || []).map((c, i) => (
      <Breadcrumbs.Item key={i} href={i === crumbs.length - 1 || isDisabled || !c.to || c.to === '#' ? undefined : c.to}>
        {c.label}
      </Breadcrumbs.Item>
    ));
  }

  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <Link to="/dashboard" className="breadcrumb-home" aria-label="Go to home page" title="Home">
        ⌂
      </Link>
      {showBack && (
        <button type="button" className="breadcrumb-back" onClick={goBack} aria-label="Go back">
          ‹ Back
        </button>
      )}
      <RouterProvider navigate={navigate}>
        <Breadcrumbs isDisabled={isDisabled} separator={separator}>
          {items}
        </Breadcrumbs>
      </RouterProvider>
    </nav>
  );
}

AppBreadcrumbs.Item = Breadcrumbs.Item;

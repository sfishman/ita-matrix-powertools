import mptUserSettings, { registerSetting } from "../../settings/userSettings";
import { printNotification, iataToUtcOffset } from "../../utils";
import { validatePaxcount, registerLink } from "../../print/links";
import { currentItin } from "../../parse/itin";
import apTimeZones from "../../json/timezones.json";

const aaSabreEditions = [
  { value: "BS", name: "Bahamas (USD)" },
  { value: "VG", name: "British Virgin Islands (USD)" },
  { value: "CA", name: "Canada (CAD)" },
  { value: "PR", name: "Puerto Rico (USD)" },
  { value: "GB", name: "United Kingdom (GBP)" },
  { value: "US", name: "United States (USD)" }
];

function printAaSabre() {
  var dateToEpoch = function(y, m, d) {
    var dateStr =
      y +
      "-" +
      ("0" + m).slice(-2) +
      "-" +
      ("0" + d).slice(-2) +
      "T00:00:00-06:00";
    return Date.parse(dateStr);
  };

  let datetimeToEpoch = function(y, m, d, t, ap) {
    /**
     * This function converts a datetime from the local timezone of the
     * departing airport to its epoch value, while accounting for
     * daylight savings time (DST) differences in future months.
     *
     * This function accepts the IATA code for a given airport and
     * retrieves the timezone from a static array of known airport data
     * (sourced from https://openflights.org/data.html, reduced to
     * airports with IATA code, and converted to keyed json format).
     * We use that timezone and Moment Timezone to account for DST if
     * the future date and timezone fall in a known DST locale.
     *
     * Future TODO: The static airport data adds bloat and must be
     * manually updated. Moment Timezone also adds bloat. Consider
     * alternative implementations?
     *
     * @param y 4-digit year
     * @param m 2-digit month
     * @param d 2-digit day
     * @param t 24-hour formatted time (HH:MM)
     * @param y 4-digit year
     * @param ap IATA airport code
     * @returns Adjusted datetime string with offset in format YYYY-MM-DDTHH:MM:00+XX:00
     */

    let datetimeStr =
      y +
      "-" +
      ("0" + m).slice(-2) +
      "-" +
      ("0" + d).slice(-2) +
      "T" +
      t +
      ":00";

    // use Moment Timezone to adjust for (if needed) DST of airport:
    // (data is filtered to only +2 years to reduce file size)
    let moment = require("moment-timezone");
    let adjustedStr = moment.tz(datetimeStr, apTimeZones[ap].Timezone).format();
    return Date.parse(adjustedStr);
  };

  // validate Passengers here: Max Paxcount = 7 (Infs not included) - >11 = Adult - InfSeat = Child
  var createUrl = function(edition) {
    var pax = validatePaxcount({
      maxPaxcount: 6,
      countInf: true,
      childAsAdult: 12,
      sepInfSeat: false,
      childMinAge: 2
    });
    if (!pax) {
      printNotification("Error: Failed to validate Passengers in printAaSabre");
      return false;
    }
    var url = "https://www.aa.com/goto/metasearch?ITEN=GOOGLE,0,";
    url += (edition || "US") + ",";
    if (currentItin.itin.length === 1) {
      url += "oneWay";
    } else {
      url += "multi";
    }
    url +=
      ",4,A" +
      pax.adults +
      "S0C" +
      pax.children.length +
      "I" +
      pax.infLap +
      "Y0L0,0,";
    url += currentItin.itin[0].orig + ",0," + currentItin.itin[0].dest;
    url += ",0";

    if (currentItin.itin.length > 1) {
      for (var i = 0; i < currentItin.itin.length; i++) {
        url += ",0,0";
      }
    } else {
      url += ",0"; // for oneWay only
    }

    if (currentItin.itin.length == 2) {
      // insert additional parameter zeros for roundtrips or 2-leg multi-city:
      url += ",0,0";
    } else if (currentItin.itin.length == 1) {
      // insert the departure time before the price for oneWay only:
      url +=
        "," +
        datetimeToEpoch(
          currentItin.itin[0].seg[0].dep.year,
          currentItin.itin[0].seg[0].dep.month,
          currentItin.itin[0].seg[0].dep.day,
          currentItin.itin[0].seg[0].dep.time24,
          currentItin.itin[0].seg[0].orig
        );
    }
    url += "," + currentItin.price + ",1,";

    // this part for RT and multi-city only:
    if (currentItin.itin.length > 1) {
      var addon = "";
      for (var i = 0; i < currentItin.itin.length; i++) {
        addon +=
          "#" +
          currentItin.itin[i].orig +
          "|" +
          currentItin.itin[i].dest +
          "|0|0|";
        addon += datetimeToEpoch(
          currentItin.itin[i].seg[0].dep.year,
          currentItin.itin[i].seg[0].dep.month,
          currentItin.itin[i].seg[0].dep.day,
          currentItin.itin[i].seg[0].dep.time24,
          currentItin.itin[i].seg[0].orig
        );
      }
      url += encodeURIComponent(addon) + ",";
    }

    var itinsegs = new Array();

    // Build multi-city search based on legs:
    for (var i = 0; i < currentItin.itin.length; i++) {
      // outer loop traverses each leg
      for (var j = 0; j < currentItin.itin[i].seg.length; j++) {
        // inner loop traverses each segment of the leg
        var k = 0;
        // skip this segment ONLY IF the flight number is the
        // same as the next segment and it is only a layover
        while (j + k < currentItin.itin[i].seg.length - 1) {
          if (
            currentItin.itin[i].seg[j + k].fnr !==
              currentItin.itin[i].seg[j + k + 1].fnr ||
            currentItin.itin[i].seg[j + k].layoverduration >= 1440
          )
            break;
          k++;
        }
        let itinseg =
          "#" +
          currentItin.itin[i].seg[j].carrier +
          "|" +
          currentItin.itin[i].seg[j].fnr +
          "|" +
          currentItin.itin[i].seg[j].bookingclass +
          "|" +
          currentItin.itin[i].seg[j].orig +
          "|" +
          currentItin.itin[i].seg[j + k].dest +
          "|" +
          datetimeToEpoch(
            currentItin.itin[i].seg[j].dep.year,
            currentItin.itin[i].seg[j].dep.month,
            currentItin.itin[i].seg[j].dep.day,
            currentItin.itin[i].seg[j].dep.time24,
            currentItin.itin[i].seg[j].orig
          );
        itinseg += "|" + i;
        itinsegs.push(itinseg);
        j += k;
      }
    }
    url += encodeURIComponent(itinsegs.join(""));
    return url;
  };
  var url = createUrl(mptUserSettings.aaSabreEdition.toUpperCase());
  if (!url) {
    return;
  }
  var extra =
    ' <span class="pt-hover-container">[+]<span class="pt-hover-menu">';
  extra += aaSabreEditions
    .map(function(edition, i) {
      return (
        '<a href="' +
        createUrl(edition.value.toUpperCase()) +
        '" target="_blank">' +
        edition.name +
        "</a>"
      );
    })
    .join("<br/>");
  extra += "</span></span>";

  return {
    url,
    title: "American",
    desc: "America & UK",
    extra
  };
}

registerLink("airlines", printAaSabre);
registerSetting(
  "American (America & UK)",
  "aaSabreEdition",
  aaSabreEditions,
  "US"
);
